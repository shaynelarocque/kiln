//! Kiln's MCP server: lets Claude and other MCP clients on this machine work on the open project
//! (Settings › AI assistants). It speaks MCP's Streamable HTTP transport on 127.0.0.1, answers
//! the protocol itself and hands tool calls to the editor window, where the tools live
//! (src/app/mcp): they edit through the same actions as the UI, so every change shows on the
//! canvas and undoes there.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tiny_http::{Header, Method, Request, Response, Server};

const DEFAULT_PORT: u16 = 7358;
/// Protocol versions spoken, newest first.
const VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
/// Longest a tool may take in the page: a flash waits for the person to say yes.
const TIMEOUT: Duration = Duration::from_secs(120);
const MAX_BODY: u64 = 8 << 20;

const INSTRUCTIONS: &str = "Kiln is a Figma-style editor for LVGL 9.6 user interfaces on \
microcontrollers (ESP32 and friends). These tools work on the project open in Kiln, live: every \
edit shows on the canvas at once, and the person can undo it there (⌘Z). Start with get_project, \
then get_screen for a screen's layers, and get_catalog for the widget types, their props and the \
style properties. Positions and sizes are display pixels; other values are LVGL's own units \
(opacity 0-255, rotation in tenths of a degree, scale 256 = 100%). Look at your work with \
render_screen: it draws the screen with the same LVGL the board runs, so what you see is what \
flashes. build exports the project and runs PlatformIO in the background; follow it with \
build_status. Flashing asks the person in Kiln first. read_serial shows what the board prints.";

#[derive(Default)]
pub struct Mcp {
    server: Mutex<Option<Arc<Server>>>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>,
    next: AtomicU64,
    /// KILN_MCP=1 keeps it on whatever Settings say (for tests and scripts)
    forced: AtomicBool,
}

fn port() -> u16 {
    std::env::var("KILN_MCP_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

fn url() -> String {
    format!("http://127.0.0.1:{}/mcp", port())
}

impl Mcp {
    fn start<R: Runtime>(&self, app: &AppHandle<R>) -> Result<String, String> {
        let mut server = self.server.lock().unwrap();
        if server.is_none() {
            let listening = Server::http(("127.0.0.1", port()))
                .map(Arc::new)
                .map_err(|e| format!("Couldn't listen on port {}: {e}", port()))
                .inspect_err(|e| log::warn!("MCP: {e}"))?;
            let (app, incoming) = (app.clone(), listening.clone());
            std::thread::spawn(move || {
                for request in incoming.incoming_requests() {
                    let app = app.clone();
                    std::thread::spawn(move || serve(&app, request));
                }
            });
            *server = Some(listening);
            log::info!("MCP server on {}", url());
        }
        Ok(url())
    }

    pub fn stop(&self) {
        if let Some(server) = self.server.lock().unwrap().take() {
            server.unblock();
            log::info!("MCP server stopped");
        }
    }
}

/// Starts the server when KILN_MCP=1, and keeps it on.
pub fn start_if_asked<R: Runtime>(app: &AppHandle<R>) {
    if std::env::var("KILN_MCP").is_ok_and(|v| v == "1") {
        let mcp = app.state::<Mcp>();
        mcp.forced.store(true, Ordering::SeqCst);
        let _ = mcp.start(app);
    }
}

/// Turns the server on or off (Settings); returns its URL while it's on.
#[tauri::command]
pub fn mcp_enable<R: Runtime>(
    app: AppHandle<R>,
    mcp: State<'_, Mcp>,
    on: bool,
) -> Result<Option<String>, String> {
    if on || mcp.forced.load(Ordering::SeqCst) {
        mcp.start(&app).map(Some)
    } else {
        mcp.stop();
        Ok(None)
    }
}

/// The editor's answer to a request it was sent as an `mcp` event.
#[tauri::command]
pub fn mcp_reply(mcp: State<'_, Mcp>, id: u64, ok: Option<Value>, error: Option<String>) {
    if let Some(tx) = mcp.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(match error {
            Some(e) => Err(e),
            None => Ok(ok.unwrap_or(Value::Null)),
        });
    }
}

/// Hands a request to the editor window and waits for its answer.
fn ask<R: Runtime>(app: &AppHandle<R>, kind: &str, params: Value) -> Result<Value, String> {
    if app.get_webview_window("main").is_none() {
        return Err("Kiln's editor window isn't open".into());
    }
    let mcp = app.state::<Mcp>();
    let id = mcp.next.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    mcp.pending.lock().unwrap().insert(id, tx);
    let answer = app
        .emit_to("main", "mcp", json!({ "id": id, "kind": kind, "params": params }))
        .map_err(|e| e.to_string())
        .and_then(|_| {
            rx.recv_timeout(TIMEOUT)
                .map_err(|_| "Kiln didn't answer in time".to_string())
        })
        .and_then(|r| r);
    mcp.pending.lock().unwrap().remove(&id);
    answer
}

/// One JSON-RPC message in, its response out (None for notifications and responses). The tools
/// themselves are `ask`ed of the editor.
pub(crate) fn handle(msg: &Value, ask: &dyn Fn(&str, Value) -> Result<Value, String>) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg.get("method")?.as_str()?;
    let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
    let result = match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str);
            let version = VERSIONS.iter().find(|v| Some(**v) == asked).unwrap_or(&VERSIONS[0]);
            Ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "kiln", "title": "Kiln", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => ask("list", Value::Null).map_err(|e| (-32603, e)),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("?").to_string();
            log::info!("MCP: {name}");
            // a tool that fails is a result the model can read, not a protocol error
            Ok(ask("call", params).unwrap_or_else(|e| {
                log::warn!("MCP: {name} failed: {e}");
                json!({ "content": [{ "type": "text", "text": e }], "isError": true })
            }))
        }
        _ => Err((-32601, format!("Method not found: {method}"))),
    };
    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        }
    })
}

/// Hosts only this machine answers to: a web page that rebinds its own name to 127.0.0.1 still
/// sends that name, and is turned away.
fn local(host: &str) -> bool {
    let name = if let Some(v6) = host.strip_prefix('[') {
        v6.split(']').next().unwrap_or("")
    } else {
        host.split(':').next().unwrap_or("")
    };
    matches!(name, "127.0.0.1" | "localhost" | "::1")
}

fn serve<R: Runtime>(app: &AppHandle<R>, mut request: Request) {
    let header = |name: &'static str| {
        request
            .headers()
            .iter()
            .find(|h| h.field.equiv(name))
            .map(|h| h.value.as_str().to_string())
    };
    let host_ok = header("Host").is_some_and(|h| local(&h));
    // MCP clients send no Origin; a browser page always does
    let origin_ok = header("Origin").is_none_or(|o| {
        o.split_once("://").is_some_and(|(_, rest)| local(rest.split('/').next().unwrap_or("")))
    });
    if !host_ok || !origin_ok {
        log::warn!("MCP: turned away a request from another host");
        return reply(request, Response::from_string("Forbidden").with_status_code(403));
    }
    if request.url().split('?').next() != Some("/mcp") {
        return reply(request, Response::from_string("Not found").with_status_code(404));
    }
    if *request.method() != Method::Post {
        // no server-to-client stream: everything is a POST and its answer
        let allow = Header::from_bytes("Allow", "POST").unwrap();
        return reply(request, Response::empty(405).with_header(allow));
    }
    let mut body = String::new();
    if request.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
        return reply(request, Response::from_string("Bad request").with_status_code(400));
    }
    let ask = |kind: &str, params: Value| ask(app, kind, params);
    let answer = match serde_json::from_str::<Value>(&body) {
        Err(e) => Some(json!({
            "jsonrpc": "2.0", "id": null,
            "error": { "code": -32700, "message": format!("Parse error: {e}") },
        })),
        Ok(Value::Array(batch)) => {
            let out: Vec<Value> = batch.iter().filter_map(|m| handle(m, &ask)).collect();
            (!out.is_empty()).then_some(Value::Array(out))
        }
        Ok(msg) => handle(&msg, &ask),
    };
    match answer {
        None => reply(request, Response::empty(202)),
        Some(value) => {
            let json = Header::from_bytes("Content-Type", "application/json").unwrap();
            reply(request, Response::from_string(value.to_string()).with_header(json))
        }
    }
}

fn reply<D: Read>(request: Request, response: Response<D>) {
    let _ = request.respond(response);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn editor(kind: &str, params: Value) -> Result<Value, String> {
        match kind {
            "list" => Ok(json!({ "tools": [{ "name": "get_project" }] })),
            _ if params["name"] == "broken" => Err("the editor threw".into()),
            _ => Ok(json!({ "content": [{ "type": "text", "text": "ok" }] })),
        }
    }

    fn call(msg: Value) -> Option<Value> {
        handle(&msg, &editor)
    }

    #[test]
    fn initialize_agrees_on_a_version() {
        let r = call(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "2025-03-26" } }))
        .unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(r["result"]["serverInfo"]["name"], "kiln");
        // one it doesn't know gets the newest it speaks
        let r = call(json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize",
            "params": { "protocolVersion": "1999-01-01" } }))
        .unwrap();
        assert_eq!(r["result"]["protocolVersion"], VERSIONS[0]);
    }

    #[test]
    fn notifications_get_no_answer() {
        assert!(call(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
    }

    #[test]
    fn tools_go_to_the_editor_and_failures_come_back_readable() {
        let list = call(json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/list" })).unwrap();
        assert_eq!(list["result"]["tools"][0]["name"], "get_project");
        let ok = call(json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": { "name": "get_project" } }))
        .unwrap();
        assert_eq!(ok["result"]["content"][0]["text"], "ok");
        let broken = call(json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call",
            "params": { "name": "broken" } }))
        .unwrap();
        assert_eq!(broken["result"]["isError"], true);
        assert_eq!(broken["result"]["content"][0]["text"], "the editor threw");
    }

    #[test]
    fn unknown_methods_are_protocol_errors() {
        let r = call(json!({ "jsonrpc": "2.0", "id": 6, "method": "resources/list" })).unwrap();
        assert_eq!(r["error"]["code"], -32601);
    }

    #[test]
    fn answers_only_to_this_machine() {
        assert!(local("127.0.0.1:7358"));
        assert!(local("localhost:7358"));
        assert!(local("[::1]:7358"));
        assert!(!local("evil.example:7358"));
        assert!(!local("127.0.0.1.evil.example"));
    }
}
