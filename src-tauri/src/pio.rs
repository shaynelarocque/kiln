use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};

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
    match (&path, &version) {
        (Some(p), Some(v)) => log::info!("{v} at {}", p.display()),
        (Some(p), None) => log::warn!("pio at {} didn't say its version", p.display()),
        _ => log::warn!("PlatformIO isn't installed"),
    }
    PioInfo {
        path: path.map(|p| p.display().to_string()),
        version,
    }
}

/// `pio boards --json-output`: every board definition PlatformIO knows.
#[tauri::command]
pub async fn pio_boards() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cmd = pio()?;
        cmd.args(["boards", "--json-output"]);
        output(cmd).inspect_err(|e| log::warn!("pio boards failed: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Forwards each line of a pipe, decoding loosely: one non-UTF-8 byte from a toolchain must not
/// stop the reading, or pio blocks on a full pipe and the build never finishes.
pub fn forward(pipe: impl Read, mut on_line: impl FnMut(String)) {
    let mut reader = BufReader::new(pipe);
    let mut line = Vec::new();
    while matches!(reader.read_until(b'\n', &mut line), Ok(n) if n > 0) {
        on_line(
            String::from_utf8_lossy(&line)
                .trim_end_matches(['\r', '\n'])
                .to_string(),
        );
        line.clear();
    }
}

/// `pio run` (or `pio run -t upload`) in an exported project, in a process group of its own so
/// stopping it also stops the compilers and esptool it starts.
pub fn run_command(dir: &str, upload: bool, port: Option<&str>) -> Result<Command, String> {
    let mut cmd = pio()?;
    cmd.arg("run")
        .current_dir(dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if upload {
        cmd.args(["-t", "upload"]);
        if let Some(port) = port.filter(|p| !p.is_empty()) {
            cmd.args(["--upload-port", port]);
        }
    }
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    Ok(cmd)
}

/// Runs a command to the end, handing over each line of its output as it comes and its process
/// id once it starts. Returns the exit code (-1 when a signal stopped it).
pub fn run_streaming(
    mut cmd: Command,
    on_start: impl FnOnce(u32),
    on_line: impl FnMut(String) + Send + Clone + 'static,
) -> Result<i32, String> {
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    on_start(child.id());
    let stderr = child.stderr.take().expect("piped stderr");
    let err_lines = on_line.clone();
    let errors = std::thread::spawn(move || forward(stderr, err_lines));
    forward(child.stdout.take().expect("piped stdout"), on_line);
    let _ = errors.join();
    Ok(child
        .wait()
        .map_err(|e| e.to_string())?
        .code()
        .unwrap_or(-1))
}

/// Stops a process and everything it started.
pub fn kill_tree(pid: u32) {
    #[cfg(unix)]
    let _ = Command::new("/bin/kill")
        .args(["-TERM", &format!("-{pid}")])
        .status();
    #[cfg(windows)]
    let _ = Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn collect() -> (
        impl FnMut(String) + Send + Clone + 'static,
        Arc<Mutex<Vec<String>>>,
    ) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        (move |l: String| sink.lock().unwrap().push(l), lines)
    }

    #[test]
    fn keeps_reading_past_bytes_that_arent_utf8() {
        let (on_line, lines) = collect();
        forward(&b"ok\n\xff\xfe broken\r\nstill here\n"[..], on_line);
        let lines = lines.lock().unwrap();
        assert_eq!(lines.len(), 3);
        assert!(lines[2].contains("still here"));
    }

    #[cfg(unix)]
    #[test]
    fn stopping_a_run_stops_what_it_started() {
        let mut cmd = Command::new("/bin/sh");
        // a child that would outlive its parent, holding the pipe open
        cmd.args(["-c", "echo started; sleep 30 & sleep 30"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
        let (on_line, lines) = collect();
        let started = std::time::Instant::now();
        let code = run_streaming(
            cmd,
            |pid| {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    kill_tree(pid);
                });
            },
            on_line,
        )
        .unwrap();
        assert_eq!(code, -1);
        assert!(started.elapsed().as_secs() < 5, "the run outlived its stop");
        assert_eq!(lines.lock().unwrap()[0], "started");
    }

    /// The Build button's whole Rust path: `pio run` on a real export, with the log streamed back.
    /// `KILN_TEST_PROJECT=/path/to/export cargo test -- --ignored`
    #[test]
    #[ignore = "needs PlatformIO and an exported project in KILN_TEST_PROJECT"]
    fn builds_an_exported_project() {
        let dir = std::env::var("KILN_TEST_PROJECT")
            .expect("set KILN_TEST_PROJECT to an exported project");
        let (on_line, lines) = collect();
        let code = run_streaming(run_command(&dir, false, None).unwrap(), |_| {}, on_line).unwrap();
        let lines = lines.lock().unwrap();
        assert_eq!(code, 0);
        assert!(
            lines.iter().any(|l| l.contains("SUCCESS")),
            "no SUCCESS line in {} lines",
            lines.len()
        );
    }
}
