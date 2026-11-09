//! Kiln's log file, for when something goes wrong on someone else's machine: builds and flashes,
//! the serial monitor, PlatformIO, file errors, the page's errors and any panic. Help › Show Logs
//! finds it (`~/Library/Logs/<identifier>/kiln.log` on macOS).

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tauri_plugin_opener::OpenerExt;

const FILE: &str = "kiln";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some(FILE.into()),
    })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    tauri_plugin_log::Builder::new()
        .targets(targets)
        .level(log::LevelFilter::Info)
        // a long session's serial errors stay findable; three files at most
        .max_file_size(1_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(2))
        .build()
}

/// A panic goes in the log, with where it happened and a backtrace, before Rust's own report.
pub fn catch_panics() {
    let report = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!(
            "panic: {info}\n{}",
            std::backtrace::Backtrace::force_capture()
        );
        report(info);
    }));
}

/// The first line of every session: what's running, where.
pub fn hello<R: Runtime>(app: &AppHandle<R>) {
    log::info!(
        "Kiln {} on {} {} (times are UTC)",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH,
    );
}

/// Shows the log file in Finder (or the platform's file manager), ready to attach to a message.
#[tauri::command]
pub fn reveal_logs<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let file = dir.join(format!("{FILE}.log"));
    app.opener()
        .reveal_item_in_dir(if file.exists() { file } else { dir })
        .map_err(|e| e.to_string())
}
