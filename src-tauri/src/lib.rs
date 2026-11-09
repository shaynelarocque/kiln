mod device;
mod files;
mod logs;
mod menu;
mod pio;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, RunEvent, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// Whether the open project has unsaved changes, as the page last said (see `set_dirty`).
#[derive(Default)]
struct Dirty(AtomicBool);

#[tauri::command]
fn set_dirty(dirty: tauri::State<Dirty>, value: bool) {
    dirty.0.store(value, Ordering::SeqCst);
}

/// Quits, asking first when that would stop a flash or leave changes unsaved.
fn quit<R: Runtime>(app: &AppHandle<R>) {
    let busy = app.state::<device::Jobs>().running();
    let dirty = app.state::<Dirty>().0.load(Ordering::SeqCst);
    let question = match (busy, dirty) {
        (false, false) => return app.exit(0),
        (true, _) => "A build is still running. Quit and stop it?",
        (false, true) => "Quit without saving? Your changes stay in Kiln's autosave.",
    };
    let app = app.clone();
    app.dialog()
        .message(question)
        .title("Kiln")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit".into(),
            "Cancel".into(),
        ))
        .show(move |ok| {
            if ok {
                app.exit(0)
            }
        });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logs::catch_panics();
    tauri::Builder::default()
        // first, so the other plugins' setup can log
        .plugin(logs::plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(device::Jobs::default())
        .manage(device::Monitor::default())
        .manage(Dirty::default())
        .setup(|app| {
            logs::hello(app.handle());
            Ok(())
        })
        .menu(menu::build)
        .on_menu_event(|app, event| menu::handle(app, event.id().as_ref()))
        // elsewhere than macOS, the app is its editor window: the output window goes with it
        .on_window_event(|window, event| {
            if cfg!(not(target_os = "macos"))
                && window.label() == "main"
                && matches!(event, tauri::WindowEvent::Destroyed)
            {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            files::read_text,
            files::write_text,
            files::write_project,
            pio::pio_info,
            pio::pio_boards,
            device::job_start,
            device::job_stop,
            device::job_state,
            device::serial_ports,
            device::monitor_open,
            device::monitor_close,
            device::monitor_clear,
            device::monitor_send,
            device::monitor_reset,
            device::monitor_state,
            device::open_output_window,
            logs::reveal_logs,
            set_dirty,
        ])
        .build(tauri::generate_context!())
        .expect("error while running Kiln")
        .run(|app, event| match event {
            // the dock icon brings back a closed (hidden) editor
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
            // leaving never orphans a build or holds a port
            RunEvent::Exit => {
                app.state::<device::Jobs>().stop();
                app.state::<device::Monitor>().close();
            }
            _ => {}
        });
}
