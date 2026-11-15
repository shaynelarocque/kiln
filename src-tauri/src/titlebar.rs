//! The editor window's tab strip, drawn natively: an `NSVisualEffectView` (a titlebar material that
//! follows the window's focus, like Figma's) laid over the top of the webview, with the home button,
//! the tabs and "+" drawn on it. The page keeps the tab state (React); it pushes it here with
//! `tabs_set`, and clicks come back as `tabs-action` events. No private API, so it suits the App Store.
//! Elsewhere than macOS the page draws its own strip and these commands do nothing.

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone)]
pub struct TabInfo {
    id: String,
    title: String,
    dirty: bool,
}

/// CSS colours (`#rrggbb` or `rgb()`), read from the page's theme so the strip follows it.
#[derive(Deserialize, Clone)]
pub struct Palette {
    bg: String,
    hover: String,
    line: String,
    text: String,
    dim: String,
    faint: String,
    accent: String,
}

#[derive(Deserialize, Clone)]
pub struct TabsState {
    tabs: Vec<TabInfo>,
    active: Option<String>,
    home: bool,
    palette: Palette,
}

#[derive(Serialize, Clone)]
pub struct TabsAction {
    kind: &'static str, // "home" | "add" | "activate" | "close" | "move"
    id: Option<String>,
    to: Option<usize>, // "move": the dragged tab's new place
}

/// Shows the page's tabs on the native strip (macOS only; see the module doc).
#[tauri::command]
pub fn tabs_set(app: tauri::AppHandle, state: TabsState) {
    #[cfg(target_os = "macos")]
    mac::set(app, state);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, state);
}

#[cfg(not(target_os = "macos"))]
pub fn focus_changed<R: tauri::Runtime>(_window: &tauri::Window<R>) {}

#[cfg(target_os = "macos")]
pub use mac::focus_changed;

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{define_class, AllocAnyThread, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSBezierPath, NSColor, NSEvent, NSFont, NSStringDrawing,
        NSFontAttributeName, NSForegroundColorAttributeName, NSTrackingArea,
        NSTrackingAreaOptions, NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
        NSVisualEffectState, NSVisualEffectView, NSWindow, NSWindowOrderingMode,
    };
    use objc2_foundation::{
        NSDictionary, NSPoint, NSRect, NSSize, NSString,
    };
    use std::cell::RefCell;
    use tauri::{AppHandle, Emitter, Manager, Runtime, Wry};

    const BAR: f64 = 38.0;
    const LEFT: f64 = 80.0; // room for the traffic lights
    const CELL: f64 = 38.0; // home and "+"
    const TAB_MAX: f64 = 200.0;
    const TAB_MIN: f64 = 90.0;

    #[derive(Clone, Copy, PartialEq, Debug)]
    enum Hit {
        Home,
        Add,
        Tab(usize),
        Close(usize),
    }

    #[derive(Clone, Copy)]
    struct Rgba(f64, f64, f64, f64);

    impl Rgba {
        fn parse(css: &str) -> Rgba {
            let css = css.trim();
            if let Some(hex) = css.strip_prefix('#') {
                if hex.len() == 6 {
                    let n = u32::from_str_radix(hex, 16).unwrap_or(0);
                    return Rgba(
                        ((n >> 16) & 255) as f64 / 255.0,
                        ((n >> 8) & 255) as f64 / 255.0,
                        (n & 255) as f64 / 255.0,
                        1.0,
                    );
                }
            }
            let inner = css
                .trim_start_matches("rgba")
                .trim_start_matches("rgb")
                .trim_matches(|c| c == '(' || c == ')');
            let v: Vec<f64> = inner
                .split(|c: char| c == ',' || c == '/' || c.is_whitespace())
                .filter(|p| !p.is_empty())
                .filter_map(|p| p.parse().ok())
                .collect();
            match v[..] {
                [r, g, b] => Rgba(r / 255.0, g / 255.0, b / 255.0, 1.0),
                [r, g, b, a] => Rgba(r / 255.0, g / 255.0, b / 255.0, a),
                _ => Rgba(0.5, 0.5, 0.5, 1.0),
            }
        }
        fn ns(self, alpha: f64) -> Retained<NSColor> {
            NSColor::colorWithSRGBRed_green_blue_alpha(self.0, self.1, self.2, self.3 * alpha)
        }
    }

    struct Colors {
        bg: Rgba,
        hover: Rgba,
        line: Rgba,
        text: Rgba,
        dim: Rgba,
        faint: Rgba,
        accent: Rgba,
    }

    struct State {
        app: AppHandle<Wry>,
        tabs: Vec<TabInfo>,
        active: Option<String>,
        home: bool,
        hover: Option<Hit>,
        /// the tab being dragged
        drag: Option<String>,
        drag_x: f64,
        grab: f64,
        colors: Colors,
    }

    struct Ivars {
        st: RefCell<State>,
    }

    fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
        NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
    }

    fn tab_width(width: f64, n: usize) -> f64 {
        if n == 0 {
            return TAB_MAX;
        }
        ((width - LEFT - CELL * 2.0) / n as f64).clamp(TAB_MIN, TAB_MAX)
    }

    fn close_rect(tab: NSRect) -> NSRect {
        rect(
            tab.origin.x + tab.size.width - 8.0 - 20.0,
            (BAR - 20.0) / 2.0,
            20.0,
            20.0,
        )
    }

    fn contains(r: NSRect, p: NSPoint) -> bool {
        p.x >= r.origin.x
            && p.x < r.origin.x + r.size.width
            && p.y >= r.origin.y
            && p.y < r.origin.y + r.size.height
    }

    fn fill(c: Retained<NSColor>, r: NSRect) {
        c.setFill();
        NSBezierPath::fillRect(r);
    }

    fn stroke_path(c: Retained<NSColor>, width: f64, pts: &[(f64, f64)], close: bool) {
        let path = NSBezierPath::bezierPath();
        path.moveToPoint(NSPoint::new(pts[0].0, pts[0].1));
        for p in &pts[1..] {
            path.lineToPoint(NSPoint::new(p.0, p.1));
        }
        if close {
            path.closePath();
        }
        path.setLineWidth(width);
        c.setStroke();
        path.stroke();
    }

    define_class!(
        #[unsafe(super(NSView))]
        #[thread_kind = MainThreadOnly]
        #[name = "KilnTabStrip"]
        #[ivars = Ivars]
        struct TabStrip;

        impl TabStrip {
            #[unsafe(method(isFlipped))]
            fn is_flipped(&self) -> bool {
                true
            }

            #[unsafe(method(acceptsFirstMouse:))]
            fn accepts_first_mouse(&self, _e: Option<&NSEvent>) -> bool {
                true
            }

            #[unsafe(method(setFrameSize:))]
            fn set_frame_size(&self, size: NSSize) {
                unsafe { msg_send![super(self), setFrameSize: size] }
                self.setNeedsDisplay(true);
            }

            #[unsafe(method(updateTrackingAreas))]
            fn update_tracking_areas(&self) {
                unsafe { msg_send![super(self), updateTrackingAreas] }
                for a in self.trackingAreas().iter() {
                    self.removeTrackingArea(&a);
                }
                let area = unsafe {
                    NSTrackingArea::initWithRect_options_owner_userInfo(
                        NSTrackingArea::alloc(),
                        self.bounds(),
                        NSTrackingAreaOptions::MouseMoved
                            | NSTrackingAreaOptions::MouseEnteredAndExited
                            | NSTrackingAreaOptions::ActiveAlways
                            | NSTrackingAreaOptions::InVisibleRect,
                        Some(self),
                        None,
                    )
                };
                self.addTrackingArea(&area);
            }

            #[unsafe(method(mouseMoved:))]
            fn mouse_moved(&self, e: &NSEvent) {
                let hit = self.hit(e);
                let mut st = self.ivars().st.borrow_mut();
                if st.hover != hit {
                    st.hover = hit;
                    drop(st);
                    self.setNeedsDisplay(true);
                }
            }

            #[unsafe(method(mouseExited:))]
            fn mouse_exited(&self, _e: &NSEvent) {
                self.ivars().st.borrow_mut().hover = None;
                self.setNeedsDisplay(true);
            }

            #[unsafe(method(mouseDown:))]
            fn mouse_down(&self, e: &NSEvent) {
                match self.hit(e) {
                    Some(Hit::Home) => self.emit("home", None),
                    Some(Hit::Add) => self.emit("add", None),
                    Some(Hit::Tab(i)) => {
                        let id = self.ivars().st.borrow().tabs.get(i).map(|t| t.id.clone());
                        let tw = tab_width(self.bounds().size.width, self.ivars().st.borrow().tabs.len());
                        let left = LEFT + CELL + tw * i as f64;
                        let mut st = self.ivars().st.borrow_mut();
                        st.drag = id;
                        st.drag_x = left;
                        st.grab = self.point(e).x - left;
                        drop(st);
                        self.emit_tab("activate", i);
                    }
                    Some(Hit::Close(i)) => self.emit_tab("close", i),
                    None => {
                        if let Some(w) = self.window() {
                            if e.clickCount() == 2 {
                                w.performZoom(None);
                            } else {
                                w.performWindowDragWithEvent(e);
                            }
                        }
                    }
                }
            }

            #[unsafe(method(mouseDragged:))]
            fn mouse_dragged(&self, e: &NSEvent) {
                let (id, n) = {
                    let st = self.ivars().st.borrow();
                    (st.drag.clone(), st.tabs.len())
                };
                let Some(id) = id else { return };
                let tw = tab_width(self.bounds().size.width, n);
                let first = LEFT + CELL;
                let left = {
                    let mut st = self.ivars().st.borrow_mut();
                    st.drag_x = (self.point(e).x - st.grab).clamp(first, first + tw * (n as f64 - 1.0));
                    st.drag_x
                };
                self.setNeedsDisplay(true);
                let to = ((left + tw / 2.0 - first) / tw).floor().clamp(0.0, n as f64 - 1.0) as usize;
                let from = self.ivars().st.borrow().tabs.iter().position(|t| t.id == id);
                if from.is_some_and(|f| f != to) {
                    let _ = self
                        .ivars()
                        .st
                        .borrow()
                        .app
                        .emit("tabs-action", TabsAction { kind: "move", id: Some(id), to: Some(to) });
                }
            }

            #[unsafe(method(mouseUp:))]
            fn mouse_up(&self, _e: &NSEvent) {
                self.ivars().st.borrow_mut().drag = None;
                self.setNeedsDisplay(true);
            }

            #[unsafe(method(otherMouseDown:))]
            fn other_mouse_down(&self, e: &NSEvent) {
                if e.buttonNumber() == 2 {
                    if let Some(Hit::Tab(i) | Hit::Close(i)) = self.hit(e) {
                        self.emit_tab("close", i);
                    }
                }
            }

            #[unsafe(method(drawRect:))]
            fn draw_rect(&self, _dirty: NSRect) {
                self.paint();
            }
        }
    );

    impl TabStrip {
        fn new(mtm: MainThreadMarker, frame: NSRect, st: State) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Ivars { st: RefCell::new(st) });
            unsafe { msg_send![super(this), initWithFrame: frame] }
        }

        fn point(&self, e: &NSEvent) -> NSPoint {
            self.convertPoint_fromView(e.locationInWindow(), None)
        }

        fn hit(&self, e: &NSEvent) -> Option<Hit> {
            let p = self.point(e);
            let st = self.ivars().st.borrow();
            let width = self.bounds().size.width;
            if contains(rect(LEFT, 0.0, CELL, BAR), p) {
                return Some(Hit::Home);
            }
            let tw = tab_width(width, st.tabs.len());
            for i in 0..st.tabs.len() {
                let r = rect(LEFT + CELL + tw * i as f64, 0.0, tw, BAR);
                if contains(r, p) {
                    return Some(if contains(close_rect(r), p) {
                        Hit::Close(i)
                    } else {
                        Hit::Tab(i)
                    });
                }
            }
            let add = rect(LEFT + CELL + tw * st.tabs.len() as f64, 0.0, CELL, BAR);
            contains(add, p).then_some(Hit::Add)
        }

        fn emit(&self, kind: &'static str, id: Option<String>) {
            let st = self.ivars().st.borrow();
            let _ = st.app.emit("tabs-action", TabsAction { kind, id, to: None });
        }

        fn emit_tab(&self, kind: &'static str, i: usize) {
            let id = self.ivars().st.borrow().tabs.get(i).map(|t| t.id.clone());
            self.emit(kind, id);
        }

        fn paint(&self) {
            let st = self.ivars().st.borrow();
            let c = &st.colors;
            let width = self.bounds().size.width;
            // dimmed while the window isn't key, like Figma's
            let live = self.window().is_some_and(|w| w.isKeyWindow());
            let a = if live { 1.0 } else { 0.55 };

            let tw = tab_width(width, st.tabs.len());
            let line = c.line.ns(a);
            fill(line.clone(), rect(0.0, BAR - 1.0, width, 1.0));

            let cell = |x: f64, w: f64, hit: Hit, selected: bool| {
                if selected {
                    // the current cell takes the page's colour and opens into it
                    fill(c.bg.ns(1.0), rect(x, 0.0, w, BAR));
                } else if st.hover == Some(hit)
                    || matches!((st.hover, hit), (Some(Hit::Close(i)), Hit::Tab(j)) if i == j)
                {
                    fill(c.hover.ns(a), rect(x, 0.0, w, BAR - 1.0));
                }
            };

            // home
            let home_sel = st.home || st.active.is_none();
            cell(LEFT, CELL, Hit::Home, home_sel);
            fill(line.clone(), rect(LEFT, 0.0, 1.0, BAR - 1.0));
            fill(line.clone(), rect(LEFT + CELL - 1.0, 0.0, 1.0, BAR - 1.0));
            let ink = if home_sel { c.text } else { c.dim }.ns(a);
            let (hx, hy) = (LEFT + CELL / 2.0, BAR / 2.0);
            stroke_path(
                ink,
                1.3,
                &[
                    (hx - 6.0, hy),
                    (hx, hy - 5.5),
                    (hx + 6.0, hy),
                    (hx + 4.5, hy),
                    (hx + 4.5, hy + 5.5),
                    (hx - 4.5, hy + 5.5),
                    (hx - 4.5, hy),
                ],
                true,
            );

            // tabs
            let dragged = st
                .drag
                .as_ref()
                .and_then(|d| st.tabs.iter().position(|t| &t.id == d));
            // the dragged tab is drawn last, under the pointer, over its neighbours
            let order = (0..st.tabs.len())
                .filter(|i| Some(*i) != dragged)
                .chain(dragged);
            for i in order {
                let t = &st.tabs[i];
                let x = if Some(i) == dragged { st.drag_x } else { LEFT + CELL + tw * i as f64 };
                let sel = !st.home && st.active.as_deref() == Some(t.id.as_str());
                cell(x, tw, Hit::Tab(i), sel);
                fill(line.clone(), rect(x + tw - 1.0, 0.0, 1.0, BAR - 1.0));
                let ink = if sel { c.text } else { c.dim }.ns(a);
                let close = close_rect(rect(x, 0.0, tw, BAR));
                self.draw_title(&t.title, x + 14.0, tw - 14.0 - 8.0 - 20.0 - 4.0, ink);

                // close glyph, or the unsaved dot until hovered
                let (cx, cy) = (close.origin.x + 10.0, close.origin.y + 10.0);
                let over_close = st.hover == Some(Hit::Close(i));
                if over_close {
                    let p = NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(close, 4.0, 4.0);
                    c.hover.ns(a).setFill();
                    p.fill();
                }
                if t.dirty && !over_close && st.hover != Some(Hit::Tab(i)) || t.dirty && !over_close {
                    let dot = rect(cx - 3.5, cy - 3.5, 7.0, 7.0);
                    c.accent.ns(a).setFill();
                    NSBezierPath::bezierPathWithOvalInRect(dot).fill();
                } else {
                    let ink = if over_close { c.text } else { c.faint }.ns(a);
                    stroke_path(ink.clone(), 1.3, &[(cx - 3.0, cy - 3.0), (cx + 3.0, cy + 3.0)], false);
                    stroke_path(ink, 1.3, &[(cx + 3.0, cy - 3.0), (cx - 3.0, cy + 3.0)], false);
                }
            }

            // +
            let ax = LEFT + CELL + tw * st.tabs.len() as f64;
            cell(ax, CELL, Hit::Add, false);
            let ink = if st.hover == Some(Hit::Add) { c.text } else { c.dim }.ns(a);
            let (px, py) = (ax + CELL / 2.0, BAR / 2.0);
            stroke_path(ink.clone(), 1.3, &[(px - 5.5, py), (px + 5.5, py)], false);
            stroke_path(ink, 1.3, &[(px, py - 5.5), (px, py + 5.5)], false);
        }

        fn draw_title(&self, title: &str, x: f64, max: f64, color: Retained<NSColor>) {
            let font = NSFont::systemFontOfSize(12.0);
            let (f, k): (&AnyObject, &AnyObject) = (&font, &color);
            let attrs: Retained<NSDictionary<NSString, AnyObject>> = unsafe {
                NSDictionary::from_slices(
                    &[NSFontAttributeName, NSForegroundColorAttributeName],
                    &[f, k],
                )
            };
            let measure = |s: &str| unsafe { NSString::from_str(s).sizeWithAttributes(Some(&attrs)) };
            let mut text = title.to_string();
            if measure(&text).width > max {
                let mut chars: Vec<char> = title.chars().collect();
                while !chars.is_empty() {
                    chars.pop();
                    let cand = format!("{}…", chars.iter().collect::<String>().trim_end());
                    if measure(&cand).width <= max {
                        text = cand;
                        break;
                    }
                }
                if chars.is_empty() {
                    text = "…".into();
                }
            }
            let h = measure(&text).height;
            unsafe {
                NSString::from_str(&text)
                    .drawAtPoint_withAttributes(NSPoint::new(x, (BAR - h) / 2.0 - 0.5), Some(&attrs));
            }
        }
    }

    thread_local! {
        static STRIP: RefCell<Option<Retained<TabStrip>>> = const { RefCell::new(None) };
    }

    fn colors(p: &Palette) -> Colors {
        Colors {
            bg: Rgba::parse(&p.bg),
            hover: Rgba::parse(&p.hover),
            line: Rgba::parse(&p.line),
            text: Rgba::parse(&p.text),
            dim: Rgba::parse(&p.dim),
            faint: Rgba::parse(&p.faint),
            accent: Rgba::parse(&p.accent),
        }
    }

    /// Lays the material and the strip over the webview's top, once.
    fn install(app: &AppHandle<Wry>, window: &NSWindow, state: &TabsState) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let Some(content) = window.contentView() else { return };
        let width = content.bounds().size.width;
        let height = content.bounds().size.height;
        let frame = rect(0.0, height - BAR, width, BAR);

        let effect = NSVisualEffectView::initWithFrame(NSVisualEffectView::alloc(mtm), frame);
        effect.setMaterial(NSVisualEffectMaterial::HeaderView);
        effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
        effect.setState(NSVisualEffectState::FollowsWindowActiveState);
        effect.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewMinYMargin,
        );

        let strip = TabStrip::new(
            mtm,
            rect(0.0, 0.0, width, BAR),
            State {
                app: app.clone(),
                tabs: vec![],
                active: None,
                home: true,
                hover: None,
                drag: None,
                drag_x: 0.0,
                grab: 0.0,
                colors: colors(&state.palette),
            },
        );
        strip.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        effect.addSubview(&strip);
        content.addSubview_positioned_relativeTo(&effect, NSWindowOrderingMode::Above, None);
        STRIP.with(|s| *s.borrow_mut() = Some(strip));
    }

    pub fn set(app: AppHandle<Wry>, state: TabsState) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(win) = handle.get_webview_window("main") else { return };
            let Ok(ptr) = win.ns_window() else { return };
            let window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
            if STRIP.with(|s| s.borrow().is_none()) {
                install(&handle, window, &state);
            }
            STRIP.with(|s| {
                if let Some(strip) = s.borrow().as_ref() {
                    {
                        let mut st = strip.ivars().st.borrow_mut();
                        st.tabs = state.tabs.clone();
                        st.active = state.active.clone();
                        st.home = state.home;
                        st.colors = colors(&state.palette);
                    }
                    strip.setNeedsDisplay(true);
                }
            });
        });
    }

    /// The window gained or lost focus: the strip dims (the material follows by itself).
    pub fn focus_changed<R: Runtime>(window: &tauri::Window<R>) {
        if window.label() != "main" {
            return;
        }
        let _ = window.run_on_main_thread(|| {
            STRIP.with(|s| {
                if let Some(strip) = s.borrow().as_ref() {
                    strip.setNeedsDisplay(true);
                }
            });
        });
    }
}
