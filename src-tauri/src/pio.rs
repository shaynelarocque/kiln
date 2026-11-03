use serde::Serialize;
use std::io::{BufRead, BufReader};
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
        let errors = std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = err_channel.send(RunEvent::Line { text: line });
            }
        });
        for line in BufReader::new(child.stdout.take().expect("piped stdout")).lines().map_while(Result::ok) {
            let _ = on_event.send(RunEvent::Line { text: line });
        }
        let _ = errors.join();
        let code = child.wait().map_err(|e| e.to_string())?.code().unwrap_or(-1);
        let _ = on_event.send(RunEvent::Done { code });
        Ok(code)
    })
    .await
    .map_err(|e| e.to_string())?
}
