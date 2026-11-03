use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::ipc::Channel;

/// A Finder-launched app doesn't get the shell's PATH, so also look where PlatformIO
/// installers put `pio` (its own penv, pipx/uv, Homebrew).
fn pio_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join(".platformio/penv/bin/pio"));
        candidates.push(home.join(".local/bin/pio"));
    }
    candidates.push("/opt/homebrew/bin/pio".into());
    candidates.push("/usr/local/bin/pio".into());
    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&paths).map(|p| p.join("pio")));
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn pio() -> Result<Command, String> {
    pio_path()
        .map(Command::new)
        .ok_or_else(|| "PlatformIO isn't installed (https://platformio.org/install/cli)".into())
}

fn output(mut cmd: Command) -> Result<String, String> {
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[derive(Serialize)]
pub struct PioInfo {
    path: Option<String>,
    version: Option<String>,
}

#[tauri::command]
pub async fn pio_info() -> PioInfo {
    let path = pio_path();
    let version = pio().ok().and_then(|mut c| {
        c.arg("--version");
        output(c).ok().map(|v| v.trim().to_string())
    });
    PioInfo { path: path.map(|p| p.display().to_string()), version }
}

/// `pio boards --json-output`: every board definition PlatformIO knows.
#[tauri::command]
pub async fn pio_boards() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cmd = pio()?;
        cmd.args(["boards", "--json-output"]);
        output(cmd)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Serial ports, for picking where to upload.
#[tauri::command]
pub async fn pio_devices() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cmd = pio()?;
        cmd.args(["device", "list", "--json-output"]);
        output(cmd)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunEvent {
    Line { text: String },
    Done { code: i32 },
}

/// Forwards each line of a pipe, decoding loosely: one non-UTF-8 byte from a toolchain must not
/// stop the reading, or pio blocks on a full pipe and the build never finishes.
fn forward(pipe: impl Read, channel: &Channel<RunEvent>) {
    let mut reader = BufReader::new(pipe);
    let mut line = Vec::new();
    while matches!(reader.read_until(b'\n', &mut line), Ok(n) if n > 0) {
        let text = String::from_utf8_lossy(&line).trim_end_matches(['\r', '\n']).to_string();
        let _ = channel.send(RunEvent::Line { text });
        line.clear();
    }
}

/// `pio run` (or `pio run -t upload`) in an exported project, streaming its output.
#[tauri::command]
pub async fn pio_run(dir: String, upload: bool, port: Option<String>, on_event: Channel<RunEvent>) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = pio()?;
        cmd.arg("run").current_dir(&dir).stdout(Stdio::piped()).stderr(Stdio::piped());
        if upload {
            cmd.args(["-t", "upload"]);
            if let Some(port) = port.filter(|p| !p.is_empty()) {
                cmd.args(["--upload-port", &port]);
            }
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let stderr = child.stderr.take().expect("piped stderr");
        let err_channel = on_event.clone();
        let errors = std::thread::spawn(move || forward(stderr, &err_channel));
        forward(child.stdout.take().expect("piped stdout"), &on_event);
        let _ = errors.join();
        let code = child.wait().map_err(|e| e.to_string())?.code().unwrap_or(-1);
        let _ = on_event.send(RunEvent::Done { code });
        Ok(code)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tauri::ipc::InvokeResponseBody;

    fn collect() -> (Channel<RunEvent>, Arc<Mutex<Vec<String>>>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(json);
            }
            Ok(())
        });
        (channel, lines)
    }

    #[test]
    fn keeps_reading_past_bytes_that_arent_utf8() {
        let (channel, lines) = collect();
        forward(&b"ok\n\xff\xfe broken\r\nstill here\n"[..], &channel);
        let lines = lines.lock().unwrap();
        assert_eq!(lines.len(), 3);
        assert!(lines[2].contains("still here"));
    }

    /// The Build button's whole Rust path: pio_run on a real export, with the log streamed back.
    /// `KILN_TEST_PROJECT=/path/to/export cargo test -- --ignored`
    #[test]
    #[ignore = "needs PlatformIO and an exported project in KILN_TEST_PROJECT"]
    fn builds_an_exported_project() {
        let dir = std::env::var("KILN_TEST_PROJECT").expect("set KILN_TEST_PROJECT to an exported project");
        let (channel, lines) = collect();
        let code = tauri::async_runtime::block_on(pio_run(dir, false, None, channel)).unwrap();
        let lines = lines.lock().unwrap();
        assert_eq!(code, 0);
        assert!(lines.iter().any(|l| l.contains("SUCCESS")), "no SUCCESS line in {} lines", lines.len());
        assert!(lines.last().unwrap().contains(r#""kind":"done""#));
    }
}
