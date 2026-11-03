# Goals

What "done" means for Kiln, and where each goal stands. Flags: ✅ done · 🟡 partial · ⬜ not started · ➖ dropped.
Each flag is set after a review against the code, not from memory.

| # | Goal | Flag | Evidence |
|---|------|------|----------|
| G1 | **Stack and structure**: Tauri 2 shell, React + TypeScript + Vite + pnpm, zustand view-models (MVVM), feature-sliced folders checked by Steiger | 🟡 | `src/` layers, `steiger.config.ts`, `src-tauri/` |
| G2 | **Real LVGL preview**: LVGL 9.6 compiled to wasm, rendering the canvas pixel-for-pixel at RGB565, with input | ✅ | `runtime/`, `src/shared/lvgl/runtime.ts`, `compile.test.ts` |
| G3 | **Figma-style editing**: infinite canvas of screens, layers, insert, select/move/resize with smart guides, auto-layout reorder, undo/redo, copy/paste, groups, save/open | 🟡 | `widgets/canvas`, `widgets/layers-panel`, `features/node-actions` |
| G4 | **Web-like styling**: CSS-like props per part and state (incl. state combos), flexbox auto layout, shared styles (classes), colour tokens, theme | 🟡 | `widgets/inspector`, `shared/ui/StyleProps.tsx` |
| G5 | **Web-like animation**: CSS-style transitions on state changes; keyframe timelines with cubic-bezier easing, delay, repeat, alternate; autoplay or triggered | 🟡 | `compile.ts` timelines + transitions; timeline editor pending |
| G6 | **Variables and bindings**: LVGL subjects bound to text, values, checked, visibility, state, mapped style props, chart history; simulated in Play | 🟡 | `BindTab.tsx`, `DataPanel.tsx`, `ProjectPlayer` |
| G7 | **Interactions and Play**: events → navigate (screen transitions), set/step/toggle variables, play animations; Play mode runs it all on real LVGL | ✅ | `InteractTab.tsx`, `widgets/player` |
| G8 | **PlatformIO hookups**: board catalog from PlatformIO board definitions, MCU pin maps and checks, display presets, variables fed from ADC/digital/sensors and driving pins, memory budget | 🟡 | `entities/board`, `DataPanel.tsx`; board dialog pending |
| G9 | **LVGL export**: clean LVGL 9.6 C + a PlatformIO project for ESP32-C3 that compiles; never overwrites the user's code | ✅ | `features/export-firmware`, `firmware.test.ts` (clang), `pio run` on esp32-c3-devkitm-1 |
| G10 | **Build and flash from the app**: run `pio run` / upload with streamed logs | 🟡 | `src-tauri/src/pio.rs`; export dialog pending |
| G11 | **Images**: import PNG/JPG, convert to LVGL formats (RGB565 / RGB565A8 / ARGB8888) with optional Bayer dithering | ⬜ | |
| G12 | **Quality**: tests for the compiler, runtime, export (compiled against LVGL), canvas maths and Rust file writes; typecheck and Steiger clean; README for Michael; this file reviewed | 🟡 | `pnpm check`, `cargo test` |
