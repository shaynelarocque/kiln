//! The editor window's tab strip, drawn natively: an `NSVisualEffectView` (a titlebar material that
//! follows the window's focus, like Figma's) laid over the top of the webview, with the home button,
//! the tabs and "+" drawn on it. The page keeps the tab state (React); it pushes it here with
//! `tabs_set`, and clicks come back as `tabs-action` events. No private API, so it suits the App Store.
//! Like the page's strip, the tabs scroll sideways when they overflow, each item has a tooltip, and
//! VoiceOver sees them all. The strip also centres the traffic lights on itself.
//! Elsewhere than macOS the page draws its own strip and these commands do nothing.

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone)]
pub struct TabInfo {
    id: String,
    title: String,
    /// the project's file, for the tooltip (none until it's saved)
    path: Option<String>,
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

#[cfg(not(target_os = "macos"))]
pub fn setup(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
pub use mac::{focus_changed, setup};

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{
        define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, Message,
    };
    use objc2_app_kit::{
        NSAccessibility, NSAccessibilityButtonRole, NSAccessibilityElement,
        NSAccessibilityRadioButtonRole, NSAccessibilityRole, NSAccessibilityTabGroupRole,
        NSAutoresizingMaskOptions, NSBezierPath, NSColor, NSEvent, NSFont, NSFontAttributeName,
        NSForegroundColorAttributeName, NSGraphicsContext, NSStringDrawing, NSTrackingArea,
        NSTrackingAreaOptions, NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
        NSVisualEffectState, NSVisualEffectView, NSWindow, NSWindowButton, NSWindowOrderingMode,
        NSWindowStyleMask,
    };
    use objc2_foundation::{
        NSArray, NSDictionary, NSNumber, NSObject, NSPoint, NSRect, NSSize, NSString,
    };
    use std::cell::RefCell;
    use tauri::{AppHandle, Emitter, Manager, Runtime, Wry};

    const BAR: f64 = 38.0;
    const LEFT: f64 = 80.0; // room for the traffic lights
    const CELL: f64 = 38.0; // home and "+"
    const FIRST: f64 = LEFT + CELL; // the tabs start after home, and scroll under it
    const TAB_MAX: f64 = 200.0;
    const TAB_MIN: f64 = 90.0;

    // the page's strip says the same (TabBar.tsx)
    const HOME_TIP: &str = "Projects (⇧⌘H)";
    const ADD_TIP: &str = "New or open a project";

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
        /// how far the tabs are scrolled left, when they don't fit
        scroll: f64,
        /// the tab being dragged
        drag: Option<String>,
        /// the dragged tab's place, from the first tab's (so scrolling doesn't move it)
        drag_x: f64,
        grab: f64,
        colors: Colors,
        /// the tooltips' strings: AppKit doesn't retain a tooltip's owner
        tips: Vec<Retained<NSString>>,
        /// what VoiceOver sees, in order
        ax: Vec<Retained<TabElement>>,
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

    /// Where the tabs and "+" are drawn, given the strip's width and the scroll.
    #[derive(Clone, Copy)]
    struct Geo {
        width: f64,
        tw: f64,
        n: usize,
        scroll: f64,
    }

    impl Geo {
        fn tab(self, i: usize) -> NSRect {
            rect(FIRST + self.tw * i as f64 - self.scroll, 0.0, self.tw, BAR)
        }
        fn add(self) -> NSRect {
            rect(FIRST + self.tw * self.n as f64 - self.scroll, 0.0, CELL, BAR)
        }
        /// the scrolling part: right of home
        fn view(self) -> NSRect {
            rect(FIRST, 0.0, self.width - FIRST, BAR)
        }
        fn max_scroll(self) -> f64 {
            (self.tw * self.n as f64 + CELL - (self.width - FIRST)).max(0.0)
        }
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

    /// `r`'s part within `to`, sideways (empty if none).
    fn clip(r: NSRect, to: NSRect) -> NSRect {
        let x0 = r.origin.x.max(to.origin.x);
        let x1 = (r.origin.x + r.size.width).min(to.origin.x + to.size.width);
        rect(x0, r.origin.y, (x1 - x0).max(0.0), r.size.height)
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

    fn close_tip(t: &TabInfo) -> &'static str {
        if t.dirty {
            "Unsaved changes. Close"
        } else {
            "Close (⌘W)"
        }
    }

    /// Centres the traffic lights on the strip. `trafficLightPosition` (tauri.conf.json) only sets
    /// where they start: where that lands differs between macOS versions, so they're measured and
    /// moved instead. Tao re-applies the position's x now and then, but keeps the buttons' y.
    fn center_lights(window: &NSWindow) {
        // in full screen they live in another window, which shows over the menu bar
        if window.styleMask().contains(NSWindowStyleMask::FullScreen) {
            return;
        }
        // the strip's centre line, in the window's coordinates (from its bottom)
        let mid = window.frame().size.height - BAR / 2.0;
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            let Some(button) = window.standardWindowButton(kind) else { continue };
            let Some(parent) = (unsafe { button.superview() }) else { continue };
            let frame = button.frame();
            let y = parent.convertPoint_fromView(NSPoint::new(0.0, mid), None).y
                - frame.size.height / 2.0;
            if (frame.origin.y - y).abs() > 0.25 {
                button.setFrameOrigin(NSPoint::new(frame.origin.x, y));
            }
        }
    }

    struct ElementIvars {
        kind: &'static str,
        id: Option<String>,
        app: AppHandle<Wry>,
    }

    define_class!(
        /// One of the strip's items, as VoiceOver sees it: pressing it does what clicking it does.
        #[unsafe(super(NSAccessibilityElement))]
        #[thread_kind = MainThreadOnly]
        #[name = "KilnTabElement"]
        #[ivars = ElementIvars]
        struct TabElement;

        impl TabElement {
            #[unsafe(method(accessibilityPerformPress))]
            fn press(&self) -> bool {
                let iv = self.ivars();
                let action = TabsAction { kind: iv.kind, id: iv.id.clone(), to: None };
                let _ = iv.app.emit("tabs-action", action);
                true
            }
        }
    );

    impl TabElement {
        fn new(
            mtm: MainThreadMarker,
            kind: &'static str,
            id: Option<String>,
            app: AppHandle<Wry>,
        ) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(ElementIvars { kind, id, app });
            unsafe { msg_send![super(this), init] }
        }
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
                // narrowing the window keeps the current tab in view
                self.reveal_active();
                self.refresh();
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

            // a trackpad's sideways swipe, or a mouse's wheel, scrolls the tabs when they overflow
            #[unsafe(method(scrollWheel:))]
            fn scroll_wheel(&self, e: &NSEvent) {
                let (dx, dy) = (e.scrollingDeltaX(), e.scrollingDeltaY());
                let d = if dx.abs() > dy.abs() { dx } else { dy };
                // a wheel's deltas are lines, not points
                let d = if e.hasPreciseScrollingDeltas() { d } else { d * 16.0 };
                {
                    let mut st = self.ivars().st.borrow_mut();
                    let max = self.geo(&st).max_scroll();
                    st.scroll = (st.scroll - d).clamp(0.0, max);
                }
                let hit = self.hit(e);
                self.ivars().st.borrow_mut().hover = hit;
                self.refresh();
            }

            #[unsafe(method(mouseDown:))]
            fn mouse_down(&self, e: &NSEvent) {
                match self.hit(e) {
                    Some(Hit::Home) => self.emit("home", None),
                    Some(Hit::Add) => self.emit("add", None),
                    Some(Hit::Tab(i)) => {
                        let p = self.point(e);
                        let mut st = self.ivars().st.borrow_mut();
                        let g = self.geo(&st);
                        st.drag = st.tabs.get(i).map(|t| t.id.clone());
                        st.drag_x = g.tw * i as f64;
                        st.grab = p.x - g.tab(i).origin.x;
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
                let p = self.point(e);
                let (id, to) = {
                    let mut st = self.ivars().st.borrow_mut();
                    let Some(id) = st.drag.clone() else { return };
                    let g = self.geo(&st);
                    let last = (g.n as f64 - 1.0).max(0.0);
                    st.drag_x = (p.x - st.grab - FIRST + st.scroll).clamp(0.0, g.tw * last);
                    (id, ((st.drag_x + g.tw / 2.0) / g.tw).floor().clamp(0.0, last) as usize)
                };
                self.setNeedsDisplay(true);
                let st = self.ivars().st.borrow();
                let from = st.tabs.iter().position(|t| t.id == id);
                if from.is_some_and(|f| f != to) {
                    let action = TabsAction { kind: "move", id: Some(id), to: Some(to) };
                    let _ = st.app.emit("tabs-action", action);
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
                // AppKit can put the traffic lights back (leaving full screen, say); the strip
                // redraws then too
                if let Some(w) = self.window() {
                    center_lights(&w);
                }
            }

            // VoiceOver's pointer: the item under it, else the strip
            #[unsafe(method_id(accessibilityHitTest:))]
            fn accessibility_hit_test(&self, screen: NSPoint) -> Option<Retained<NSObject>> {
                self.ax_hit(screen)
            }
        }
    );

    impl TabStrip {
        fn ax_hit(&self, screen: NSPoint) -> Option<Retained<NSObject>> {
            let w = self.window()?;
            let p = self.convertPoint_fromView(w.convertPointFromScreen(screen), None);
            Some(match self.hit_at(p).and_then(|hit| self.element(hit)) {
                Some(e) => Retained::into_super(Retained::into_super(e)),
                None => Retained::into_super(Retained::into_super(Retained::into_super(
                    self.retain(),
                ))),
            })
        }

        fn new(mtm: MainThreadMarker, frame: NSRect, st: State) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Ivars { st: RefCell::new(st) });
            let this: Retained<Self> = unsafe { msg_send![super(this), initWithFrame: frame] };
            this.setAccessibilityElement(true);
            this.setAccessibilityRole(Some(unsafe { NSAccessibilityTabGroupRole }));
            this.setAccessibilityLabel(Some(&NSString::from_str("Tabs")));
            this
        }

        fn geo(&self, st: &State) -> Geo {
            let width = self.bounds().size.width;
            let n = st.tabs.len();
            Geo { width, tw: tab_width(width, n), n, scroll: st.scroll }
        }

        fn point(&self, e: &NSEvent) -> NSPoint {
            self.convertPoint_fromView(e.locationInWindow(), None)
        }

        fn hit(&self, e: &NSEvent) -> Option<Hit> {
            self.hit_at(self.point(e))
        }

        fn hit_at(&self, p: NSPoint) -> Option<Hit> {
            if contains(rect(LEFT, 0.0, CELL, BAR), p) {
                return Some(Hit::Home);
            }
            // a tab scrolled under home isn't there
            if p.x < FIRST {
                return None;
            }
            let g = self.geo(&self.ivars().st.borrow());
            for i in 0..g.n {
                let r = g.tab(i);
                if contains(r, p) {
                    return Some(if contains(close_rect(r), p) {
                        Hit::Close(i)
                    } else {
                        Hit::Tab(i)
                    });
                }
            }
            contains(g.add(), p).then_some(Hit::Add)
        }

        /// The item's element for VoiceOver.
        fn element(&self, hit: Hit) -> Option<Retained<TabElement>> {
            let st = self.ivars().st.borrow();
            let (kind, i) = match hit {
                Hit::Home => ("home", None),
                Hit::Add => ("add", None),
                Hit::Tab(i) => ("activate", Some(i)),
                Hit::Close(i) => ("close", Some(i)),
            };
            let id = i.and_then(|i| st.tabs.get(i)).map(|t| t.id.as_str());
            st.ax.iter().find(|e| e.ivars().kind == kind && e.ivars().id.as_deref() == id).cloned()
        }

        fn emit(&self, kind: &'static str, id: Option<String>) {
            let st = self.ivars().st.borrow();
            let _ = st.app.emit("tabs-action", TabsAction { kind, id, to: None });
        }

        fn emit_tab(&self, kind: &'static str, i: usize) {
            let id = self.ivars().st.borrow().tabs.get(i).map(|t| t.id.clone());
            self.emit(kind, id);
        }

        /// Scrolls the current tab into view.
        fn reveal_active(&self) {
            let mut st = self.ivars().st.borrow_mut();
            let Some(i) = st.active.as_ref().and_then(|a| st.tabs.iter().position(|t| &t.id == a))
            else {
                return;
            };
            let g = self.geo(&st);
            let x = g.tw * i as f64;
            st.scroll = st.scroll.min(x).max(x + g.tw - g.view().size.width);
        }

        /// After the tabs, the scroll or the size change: keeps the scroll in range, and the
        /// tooltips and VoiceOver's elements on what's drawn.
        fn refresh(&self) {
            let (g, tabs, active, home, app, old) = {
                let mut st = self.ivars().st.borrow_mut();
                let max = self.geo(&st).max_scroll();
                st.scroll = st.scroll.clamp(0.0, max);
                let ax = std::mem::take(&mut st.ax);
                (self.geo(&st), st.tabs.clone(), st.active.clone(), st.home, st.app.clone(), ax)
            };
            let home_rect = rect(LEFT, 0.0, CELL, BAR);

            // tooltips on what's visible: a tab minus its close button, which has its own
            self.removeAllToolTips();
            let mut tips = vec![];
            let mut tip = |r: NSRect, text: &str| {
                if r.size.width > 0.0 {
                    let s = NSString::from_str(text);
                    // the owner's description is the tip: a string's is itself
                    unsafe { self.addToolTipRect_owner_userData(r, &s, std::ptr::null_mut()) };
                    tips.push(s);
                }
            };
            tip(home_rect, HOME_TIP);
            for (i, t) in tabs.iter().enumerate() {
                let (r, close) = (g.tab(i), close_rect(g.tab(i)));
                let (left, right) = (close.origin.x, close.origin.x + close.size.width);
                let name = t.path.as_deref().unwrap_or(&t.title);
                tip(clip(rect(r.origin.x, 0.0, left - r.origin.x, BAR), g.view()), name);
                tip(clip(rect(left, 0.0, right - left, BAR), g.view()), close_tip(t));
                tip(clip(rect(right, 0.0, r.origin.x + r.size.width - right, BAR), g.view()), name);
            }
            tip(clip(g.add(), g.view()), ADD_TIP);

            // VoiceOver: home, each tab (a radio button, as AppKit's tabs are) and its close
            // button, then "+". The elements are kept across updates, so its cursor stays put.
            let parent: &AnyObject = self;
            let mut ax = vec![];
            let mut item = |kind: &'static str,
                            id: Option<&str>,
                            role: &NSAccessibilityRole,
                            label: &str,
                            help: &str,
                            frame: NSRect,
                            selected: Option<bool>| {
                let e = old
                    .iter()
                    .find(|e| e.ivars().kind == kind && e.ivars().id.as_deref() == id)
                    .cloned()
                    .unwrap_or_else(|| {
                        TabElement::new(self.mtm(), kind, id.map(str::to_owned), app.clone())
                    });
                e.setAccessibilityRole(Some(role));
                e.setAccessibilityLabel(Some(&NSString::from_str(label)));
                e.setAccessibilityHelp(Some(&NSString::from_str(help)));
                e.setAccessibilityFrameInParentSpace(frame);
                unsafe {
                    e.setAccessibilityParent(Some(parent));
                    if let Some(on) = selected {
                        e.setAccessibilityValue(Some(&NSNumber::numberWithBool(on)));
                    }
                }
                ax.push(e);
            };
            let (button, radio) = unsafe { (NSAccessibilityButtonRole, NSAccessibilityRadioButtonRole) };
            item("home", None, button, "Projects", HOME_TIP, home_rect, None);
            for (i, t) in tabs.iter().enumerate() {
                let r = g.tab(i);
                let current = !home && active.as_deref() == Some(t.id.as_str());
                let tip = t.path.as_deref().unwrap_or(&t.title);
                item("activate", Some(&t.id), radio, &t.title, tip, r, Some(current));
                let label = format!("Close {}", t.title);
                item("close", Some(&t.id), button, &label, close_tip(t), close_rect(r), None);
            }
            item("add", None, button, "New tab", ADD_TIP, g.add(), None);
            let children: Vec<&AnyObject> = ax.iter().map(|e| -> &AnyObject { e }).collect();
            unsafe { self.setAccessibilityChildren(Some(&NSArray::from_slice(&children))) };

            {
                let mut st = self.ivars().st.borrow_mut();
                st.tips = tips;
                st.ax = ax;
            }
            self.setNeedsDisplay(true);
        }

        fn paint(&self) {
            let st = self.ivars().st.borrow();
            let c = &st.colors;
            let g = self.geo(&st);
            // dimmed while the window isn't key, like Figma's
            let live = self.window().is_some_and(|w| w.isKeyWindow());
            let a = if live { 1.0 } else { 0.55 };

            let line = c.line.ns(a);
            fill(line.clone(), rect(0.0, BAR - 1.0, g.width, 1.0));

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

            // the tabs and "+" scroll under home: they're clipped to its right
            NSGraphicsContext::saveGraphicsState_class();
            NSBezierPath::clipRect(g.view());

            // tabs
            let dragged = st
                .drag
                .as_ref()
                .and_then(|d| st.tabs.iter().position(|t| &t.id == d));
            // the dragged tab is drawn last, under the pointer, over its neighbours
            let order = (0..st.tabs.len())
                .filter(|i| Some(*i) != dragged)
                .chain(dragged);
            let tw = g.tw;
            for i in order {
                let t = &st.tabs[i];
                let x = if Some(i) == dragged {
                    FIRST + st.drag_x - st.scroll
                } else {
                    g.tab(i).origin.x
                };
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
                if t.dirty && !over_close {
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
            let ax = g.add().origin.x;
            cell(ax, CELL, Hit::Add, false);
            let ink = if st.hover == Some(Hit::Add) { c.text } else { c.dim }.ns(a);
            let (px, py) = (ax + CELL / 2.0, BAR / 2.0);
            stroke_path(ink.clone(), 1.3, &[(px - 5.5, py), (px + 5.5, py)], false);
            stroke_path(ink, 1.3, &[(px, py - 5.5), (px, py + 5.5)], false);

            NSGraphicsContext::restoreGraphicsState_class();
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
                scroll: 0.0,
                drag: None,
                drag_x: 0.0,
                grab: 0.0,
                colors: colors(&state.palette),
                tips: vec![],
                ax: vec![],
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
                    let reveal = {
                        let mut st = strip.ivars().st.borrow_mut();
                        // a tab that becomes current scrolls into view
                        let reveal = !state.home && (st.home || st.active != state.active);
                        st.tabs = state.tabs.clone();
                        st.active = state.active.clone();
                        st.home = state.home;
                        st.colors = colors(&state.palette);
                        reveal
                    };
                    if reveal {
                        strip.reveal_active();
                    }
                    strip.refresh();
                }
            });
        });
    }

    /// At launch, before the page draws the strip: the traffic lights go where it'll be.
    pub fn setup(app: &AppHandle<Wry>) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(win) = handle.get_webview_window("main") else { return };
            let Ok(ptr) = win.ns_window() else { return };
            center_lights(unsafe { &*(ptr as *const NSWindow) });
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
