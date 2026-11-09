//! The menu bar. Items that the page also has keys for (⌘S, ⌘O…) reach the page first; the menu
//! only acts when the page leaves a key alone, so nothing runs twice. Every item goes to the main
//! window as a `menu` event naming its id.

use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, keys: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, label);
        match keys {
            Some(k) => b.accelerator(k).build(app),
            None => b.build(app),
        }
    };

    let kiln = SubmenuBuilder::new(app, "Kiln")
        .about(Some(AboutMetadata {
            name: Some("Kiln".into()),
            ..Default::default()
        }))
        .separator()
        .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        // ours rather than the stock item, so a running flash or unsaved work can stop it
        .item(&item("quit", "Quit Kiln", Some("CmdOrCtrl+Q"))?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("home", "Projects", Some("CmdOrCtrl+Shift+H"))?)
        .item(&item("new", "New Project", Some("CmdOrCtrl+N"))?)
        .item(&item("open", "Open…", Some("CmdOrCtrl+O"))?)
        .separator()
        .item(&item("save", "Save", Some("CmdOrCtrl+S"))?)
        .item(&item("save-as", "Save As…", Some("CmdOrCtrl+Shift+S"))?)
        .separator()
        .item(&item("close-tab", "Close Project", Some("CmdOrCtrl+W"))?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("output", "Build Output", Some("CmdOrCtrl+J"))?)
        .item(&item("timeline", "Animations Timeline", None)?)
        .item(&item("pixel-grid", "Pixel Grid", None)?)
        .separator()
        .fullscreen()
        .build()?;

    let device = SubmenuBuilder::new(app, "Board")
        .item(&item("board", "Board, Display and Pins…", None)?)
        .separator()
        .item(&item("export", "Export Code…", Some("CmdOrCtrl+E"))?)
        .item(&item("build", "Build", Some("CmdOrCtrl+B"))?)
        .item(&item("flash", "Build and Flash", Some("CmdOrCtrl+U"))?)
        .item(&item("stop", "Stop", Some("CmdOrCtrl+."))?)
        .separator()
        .item(&item(
            "monitor",
            "Serial Monitor",
            Some("CmdOrCtrl+Shift+M"),
        )?)
        .build()?;

    // ⌘W closes the project (File), so no stock Close Window here
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("shortcuts", "Keyboard Shortcuts", None)?)
        .item(&item("logs", "Show Logs", None)?)
        .build()?;

    Menu::with_items(app, &[&kiln, &file, &edit, &view, &device, &window, &help])
}

/// Hands a menu item to the main window, bringing it back first if it was closed (hidden).
pub fn handle<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == "quit" {
        return crate::quit(app);
    }
    if id == "logs" {
        if let Err(e) = crate::logs::reveal_logs(app.clone()) {
            log::warn!("couldn't show the logs: {e}");
        }
        return;
    }
    // ⌘W in the output window closes that window, not a project
    if id == "close-tab" {
        if let Some(output) = app
            .get_webview_window("output")
            .filter(|w| w.is_focused().unwrap_or(false))
        {
            let _ = output.close();
            return;
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit_to("main", "menu", id);
}
