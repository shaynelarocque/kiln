//! Build, flash and the serial monitor, run by the app rather than by a window: they keep going
//! while the editor is used, closed or reopened, and every window sees their output (events plus
//! a backlog for windows that open late).

use crate::pio;
use serde::Serialize;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

/// Lines of build log kept for windows that open after a build started.
const LOG_LINES: usize = 4000;
/// Bytes of serial output kept for the same reason.
const MONITOR_BYTES: usize = 256 * 1024;

// ---------------------------------------------------------------------------------------------
// Build and flash

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    /// "build" or "upload"
    kind: String,
    dir: String,
    port: Option<String>,
    running: bool,
    /// the exit code once done; -1 when stopped
    code: Option<i32>,
    stopped: bool,
    /// kiln-debug's build (the kiln_debug env)
    debug: bool,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum JobEvent {
    Start { job: JobInfo },
    Line { text: String },
    Done { job: JobInfo },
}

#[derive(Default)]
pub struct Jobs {
    info: Mutex<Option<JobInfo>>,
    log: Mutex<Vec<String>>,
    pid: Mutex<Option<u32>>,
    stopping: AtomicBool,
}

impl Jobs {
    pub fn running(&self) -> bool {
        self.info
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|j| j.running)
    }

    /// Stops the running job, if any, with everything it started.
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        if let Some(pid) = *self.pid.lock().unwrap() {
            log::info!("stopping the build");
            pio::kill_tree(pid);
        }
    }
}

#[derive(Serialize)]
pub struct JobState {
    job: Option<JobInfo>,
    log: Vec<String>,
}

/// The current or last job and its log.
#[tauri::command]
pub fn job_state(jobs: State<Jobs>) -> JobState {
    JobState {
        job: jobs.info.lock().unwrap().clone(),
        log: jobs.log.lock().unwrap().clone(),
    }
}

/// Starts `pio run` (or an upload) in an exported project and returns at once; the log arrives
/// as `job` events. An upload borrows the monitor's port and gives it back when done.
#[tauri::command]
pub fn job_start(
    app: AppHandle,
    dir: String,
    upload: bool,
    port: Option<String>,
    debug: Option<bool>,
) -> Result<(), String> {
    let debug = debug.unwrap_or(false);
    let jobs = app.state::<Jobs>();
    {
        let mut info = jobs.info.lock().unwrap();
        if info.as_ref().is_some_and(|j| j.running) {
            return Err("A build is already running".into());
        }
        let job = JobInfo {
            kind: if upload { "upload" } else { "build" }.into(),
            dir: dir.clone(),
            port: port.clone().filter(|p| !p.is_empty()),
            running: true,
            code: None,
            stopped: false,
            debug,
        };
        *info = Some(job.clone());
        let command = format!(
            "$ pio run{}{}{}",
            if debug { format!(" -e {}", pio::DEBUG_ENV) } else { String::new() },
            if upload { " -t upload" } else { "" },
            job.port
                .as_ref()
                .map(|p| format!(" --upload-port {p}"))
                .unwrap_or_default()
        );
        log::info!("{} in {dir}", &command[2..]);
        *jobs.log.lock().unwrap() = vec![command.clone()];
        jobs.stopping.store(false, Ordering::SeqCst);
        let _ = app.emit("job", JobEvent::Start { job });
        let _ = app.emit("job", JobEvent::Line { text: command });
    }
    std::thread::spawn(move || run_job(app, dir, upload, port, debug));
    Ok(())
}

fn run_job(app: AppHandle, dir: String, upload: bool, port: Option<String>, debug: bool) {
    let jobs = app.state::<Jobs>();
    let monitor = app.state::<Monitor>();
    let line_app = app.clone();
    let on_line = move |text: String| {
        let jobs = line_app.state::<Jobs>();
        let mut log = jobs.log.lock().unwrap();
        if log.len() >= LOG_LINES {
            log.drain(..LOG_LINES / 4);
        }
        log.push(text.clone());
        let _ = line_app.emit("job", JobEvent::Line { text });
    };
    // esptool needs the port to itself
    let paused = upload && monitor.pause();
    if paused {
        on_line("Serial monitor paused for the upload.".into());
    }
    let result = pio::run_command(&dir, upload, port.as_deref(), debug).and_then(|cmd| {
        pio::run_streaming(
            cmd,
            |pid| *jobs.pid.lock().unwrap() = Some(pid),
            on_line.clone(),
        )
    });
    *jobs.pid.lock().unwrap() = None;
    let code = result.unwrap_or_else(|e| {
        log::error!("pio didn't run: {e}");
        on_line(e);
        -1
    });
    if paused {
        monitor.resume();
    }
    let job = {
        let mut info = jobs.info.lock().unwrap();
        let job = info.as_mut().expect("a job was started");
        job.running = false;
        job.code = Some(code);
        job.stopped = jobs.stopping.load(Ordering::SeqCst);
        job.clone()
    };
    if job.stopped {
        log::info!("{} stopped", job.kind);
    } else if code == 0 {
        log::info!("{} done", job.kind);
    } else {
        // the end of the log is where pio says what went wrong
        let log = jobs.log.lock().unwrap();
        let tail = log[log.len().saturating_sub(30)..].join("\n");
        log::warn!("{} failed with exit code {code}. Last lines:\n{tail}", job.kind);
    }
    let _ = app.emit("job", JobEvent::Done { job });
}

#[tauri::command]
pub fn job_stop(jobs: State<Jobs>) {
    jobs.stop();
}

// ---------------------------------------------------------------------------------------------
// Serial ports

#[derive(Serialize)]
pub struct PortInfo {
    port: String,
    description: String,
    usb: bool,
}

/// Serial ports to upload to or monitor, USB ones (where boards are) first. On macOS only the
/// callout devices (/dev/cu.*), which don't wait for a carrier.
#[tauri::command]
pub fn serial_ports() -> Result<Vec<PortInfo>, String> {
    let mut ports: Vec<PortInfo> = serialport::available_ports()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|p| !cfg!(target_os = "macos") || p.port_name.starts_with("/dev/cu."))
        .map(|p| match p.port_type {
            serialport::SerialPortType::UsbPort(usb) => PortInfo {
                description: [usb.manufacturer, usb.product]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .trim()
                    .to_string(),
                port: p.port_name,
                usb: true,
            },
            _ => PortInfo {
                port: p.port_name,
                description: String::new(),
                usb: false,
            },
        })
        .collect();
    ports.sort_by_key(|p| !p.usb);
    Ok(ports)
}

// ---------------------------------------------------------------------------------------------
// Serial monitor

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    port: String,
    baud: u32,
    /// "connected", "waiting" (for the port to appear), "paused" (for an upload) or "closed"
    status: String,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum MonitorEvent {
    State { monitor: MonitorInfo },
    Data { text: String },
}

/// What the monitor's thread and the commands share.
struct Session {
    port: String,
    baud: u32,
    stop: AtomicBool,
    paused: AtomicBool,
    /// whether the thread has the port open right now
    holding: AtomicBool,
    writer: Mutex<Option<Box<dyn serialport::SerialPort>>>,
}

#[derive(Default)]
pub struct Monitor {
    session: Mutex<Option<(Arc<Session>, JoinHandle<()>)>>,
    info: Mutex<Option<MonitorInfo>>,
    text: Mutex<String>,
}

impl Monitor {
    fn current(&self) -> Option<Arc<Session>> {
        self.session
            .lock()
            .unwrap()
            .as_ref()
            .map(|(s, _)| s.clone())
    }

    /// Lets go of the port for an upload, waiting briefly until it's really closed.
    fn pause(&self) -> bool {
        let Some(session) = self.current() else {
            return false;
        };
        session.paused.store(true, Ordering::SeqCst);
        let since = Instant::now();
        while session.holding.load(Ordering::SeqCst) && since.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(20));
        }
        true
    }

    fn resume(&self) {
        if let Some(session) = self.current() {
            session.paused.store(false, Ordering::SeqCst);
        }
    }

    pub fn close(&self) {
        let taken = self.session.lock().unwrap().take();
        if let Some((session, thread)) = taken {
            session.stop.store(true, Ordering::SeqCst);
            let _ = thread.join();
        }
    }
}

fn set_state<R: Runtime>(
    app: &AppHandle<R>,
    session: &Session,
    status: &str,
    error: Option<String>,
) {
    let monitor = app.state::<Monitor>();
    let info = MonitorInfo {
        port: session.port.clone(),
        baud: session.baud,
        status: status.into(),
        error,
    };
    let mut current = monitor.info.lock().unwrap();
    if current.as_ref() != Some(&info) {
        log::info!(
            "serial monitor {} at {}: {status}{}",
            info.port,
            info.baud,
            info.error.as_ref().map(|e| format!(" ({e})")).unwrap_or_default()
        );
        *current = Some(info.clone());
        let _ = app.emit("monitor", MonitorEvent::State { monitor: info });
    }
}

fn push_text<R: Runtime>(app: &AppHandle<R>, text: String) {
    let monitor = app.state::<Monitor>();
    let mut kept = monitor.text.lock().unwrap();
    kept.push_str(&text);
    if kept.len() > MONITOR_BYTES {
        // drop the oldest quarter, at a line break when there is one
        let mut cut = kept.len() - MONITOR_BYTES * 3 / 4;
        cut = kept[cut..].find('\n').map_or(cut, |i| cut + i + 1);
        while !kept.is_char_boundary(cut) {
            cut += 1;
        }
        kept.drain(..cut);
    }
    let _ = app.emit("monitor", MonitorEvent::Data { text });
}

/// The longest prefix of `bytes` that doesn't end inside a UTF-8 sequence.
fn whole_chars(bytes: &[u8]) -> usize {
    let n = bytes.len();
    for back in 1..=3.min(n) {
        let b = bytes[n - back];
        if b & 0xC0 == 0xC0 {
            // a lead byte: is its sequence complete?
            let len = if b >= 0xF0 {
                4
            } else if b >= 0xE0 {
                3
            } else {
                2
            };
            return if back >= len { n } else { n - back };
        }
        if b & 0x80 == 0 {
            return n;
        }
    }
    n
}

/// Keeps the port open, reading until told to stop. A board that resets or re-enumerates (as
/// USB ones do after a flash) drops the port; the monitor waits for it to come back.
fn monitor_loop<R: Runtime>(app: AppHandle<R>, session: Arc<Session>) {
    let mut port: Option<Box<dyn serialport::SerialPort>> = None;
    let mut buf = [0u8; 4096];
    let mut pending: Vec<u8> = Vec::new();
    let release = |port: &mut Option<Box<dyn serialport::SerialPort>>| {
        *port = None;
        *session.writer.lock().unwrap() = None;
        session.holding.store(false, Ordering::SeqCst);
    };
    while !session.stop.load(Ordering::SeqCst) {
        if session.paused.load(Ordering::SeqCst) {
            release(&mut port);
            set_state(&app, &session, "paused", None);
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }
        let Some(open) = port.as_mut() else {
            match serialport::new(&session.port, session.baud)
                .timeout(Duration::from_millis(50))
                .dtr_on_open(false)
                .open()
            {
                Ok(mut p) => {
                    // neither line asserted: no reset, and no boot-mode strap held (RTS first, so
                    // an ESP32's USB-JTAG never sees RTS alone, which resets it)
                    let _ = p.write_request_to_send(false);
                    let _ = p.write_data_terminal_ready(false);
                    *session.writer.lock().unwrap() = p.try_clone().ok();
                    session.holding.store(true, Ordering::SeqCst);
                    port = Some(p);
                    set_state(&app, &session, "connected", None);
                }
                Err(e) => {
                    set_state(&app, &session, "waiting", Some(e.to_string()));
                    std::thread::sleep(Duration::from_millis(400));
                }
            }
            continue;
        };
        match open.read(&mut buf) {
            Ok(0) => {}
            Ok(n) => {
                pending.extend_from_slice(&buf[..n]);
                let whole = whole_chars(&pending);
                let text = String::from_utf8_lossy(&pending[..whole]).into_owned();
                pending.drain(..whole);
                push_text(&app, text);
            }
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => {
                release(&mut port);
                set_state(&app, &session, "waiting", Some(e.to_string()));
            }
        }
    }
    release(&mut port);
    set_state(&app, &session, "closed", None);
}

#[derive(Serialize)]
pub struct MonitorState {
    monitor: Option<MonitorInfo>,
    text: String,
}

#[tauri::command]
pub fn monitor_state(monitor: State<Monitor>) -> MonitorState {
    MonitorState {
        monitor: monitor.info.lock().unwrap().clone(),
        text: monitor.text.lock().unwrap().clone(),
    }
}

/// Opens (or reopens, on another port or speed) the serial monitor.
#[tauri::command]
pub fn monitor_open<R: Runtime>(app: AppHandle<R>, port: String, baud: u32) -> Result<(), String> {
    if port.is_empty() || baud == 0 {
        return Err("Pick a port and a speed".into());
    }
    start_monitor(&app, port, baud);
    Ok(())
}

/// A speed of 0 leaves the port's speed alone (what a pseudo-terminal needs on macOS).
fn start_monitor<R: Runtime>(app: &AppHandle<R>, port: String, baud: u32) {
    let monitor = app.state::<Monitor>();
    monitor.close();
    let session = Arc::new(Session {
        port,
        baud,
        stop: AtomicBool::new(false),
        // a running upload owns the port; the monitor joins once it's done
        paused: AtomicBool::new(app.state::<Jobs>().running()),
        holding: AtomicBool::new(false),
        writer: Mutex::new(None),
    });
    let thread = {
        let (app, session) = (app.clone(), session.clone());
        std::thread::spawn(move || monitor_loop(app, session))
    };
    *monitor.session.lock().unwrap() = Some((session, thread));
}

#[tauri::command]
pub fn monitor_close(monitor: State<Monitor>) {
    monitor.close();
}

#[tauri::command]
pub fn monitor_clear(monitor: State<Monitor>) {
    monitor.text.lock().unwrap().clear();
}

/// Sends text to the board.
#[tauri::command]
pub fn monitor_send(monitor: State<Monitor>, text: String) -> Result<(), String> {
    let session = monitor.current().ok_or("The monitor isn't open")?;
    let mut writer = session.writer.lock().unwrap();
    let port = writer.as_mut().ok_or("The board isn't connected")?;
    port.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

/// Resets the board the way esptool does: RTS pulls EN low for a moment (DTR stays released, so
/// it boots the firmware rather than the bootloader). Works on USB-UART bridges with the usual
/// auto-reset transistors and on the ESP32's own USB.
#[tauri::command]
pub fn monitor_reset(monitor: State<Monitor>) -> Result<(), String> {
    let session = monitor.current().ok_or("The monitor isn't open")?;
    let mut writer = session.writer.lock().unwrap();
    let port = writer.as_mut().ok_or("The board isn't connected")?;
    port.write_data_terminal_ready(false)
        .map_err(|e| e.to_string())?;
    port.write_request_to_send(true)
        .map_err(|e| e.to_string())?;
    std::thread::sleep(Duration::from_millis(120));
    port.write_request_to_send(false).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------------------------
// The output window

/// Shows the build log and serial monitor in a window of their own (Settings › Build and flash
/// output). The page asks which window it's in by label.
#[tauri::command]
pub fn open_output_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("output") {
        let _ = window.unminimize();
        let _ = window.show();
        return window.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, "output", WebviewUrl::App("index.html".into()))
        .title("Kiln Output")
        .inner_size(780.0, 460.0)
        .min_inner_size(420.0, 220.0)
        .build()
        .map(|_| ())
        .map_err(|e| {
            log::warn!("couldn't open the output window: {e}");
            e.to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::whole_chars;

    #[test]
    fn holds_back_a_character_split_across_reads() {
        let degree = "°".as_bytes(); // two bytes
        let mut bytes = b"21".to_vec();
        bytes.push(degree[0]);
        assert_eq!(whole_chars(&bytes), 2);
        bytes.push(degree[1]);
        assert_eq!(whole_chars(&bytes), 4);
        assert_eq!(whole_chars("ok\n".as_bytes()), 3);
        let check = "✓".as_bytes(); // three bytes
        assert_eq!(whole_chars(&check[..2]), 0);
        assert_eq!(whole_chars(check), 3);
    }
}

#[cfg(all(test, unix))]
mod monitor_tests {
    use super::*;
    use serialport::SerialPort;
    use std::io::Read;

    fn until(what: &str, ok: impl Fn() -> bool) {
        let since = Instant::now();
        while !ok() {
            assert!(
                since.elapsed() < Duration::from_secs(5),
                "timed out waiting for {what}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// A board on a pseudo-terminal: the monitor reads it, lets go of it for an upload, takes it
    /// back after, and writes to it.
    #[test]
    fn reads_the_board_and_steps_aside_for_an_upload() {
        let app = tauri::test::mock_builder()
            .manage(Jobs::default())
            .manage(Monitor::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle().clone();
        let monitor = handle.state::<Monitor>();
        let status = || {
            monitor
                .info
                .lock()
                .unwrap()
                .as_ref()
                .map(|i| i.status.clone())
        };

        let (mut board, end) = serialport::TTYPort::pair().unwrap();
        let path = end.name().unwrap();
        drop(end);
        start_monitor(&handle, path, 0);
        until("the port to open", || {
            status().as_deref() == Some("connected")
        });

        board.write_all("21°C\r\nLVGL ".as_bytes()).unwrap();
        board.write_all(b"ready\n").unwrap();
        until("the text", || {
            monitor.text.lock().unwrap().contains("LVGL ready")
        });
        assert!(monitor.text.lock().unwrap().starts_with("21°C"));

        assert!(monitor.pause());
        let session = monitor.current().unwrap();
        assert!(
            !session.holding.load(Ordering::SeqCst),
            "the upload would find the port busy"
        );
        until("paused", || status().as_deref() == Some("paused"));
        monitor.resume();
        until("the port to reopen", || {
            status().as_deref() == Some("connected")
        });

        session
            .writer
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .write_all(b"hi\n")
            .unwrap();
        board.set_timeout(Duration::from_secs(2)).unwrap();
        let mut got = [0u8; 3];
        board.read_exact(&mut got).unwrap();
        assert_eq!(&got, b"hi\n");

        monitor.close();
        assert_eq!(status().as_deref(), Some("closed"));
    }
}
