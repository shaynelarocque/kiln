# Goals

What "done" means for Kiln, and where each goal stands. Flags: ✅ done · 🟡 partial · ⬜ not started · ➖ dropped.
Each flag was set in a review against the code and the checks, not from memory. The review log is at the end.

| # | Goal | Flag | Evidence |
|---|------|------|----------|
| G1 | **Stack and structure**: Tauri 2 shell, React + TypeScript + Vite + pnpm, zustand view-models (MVVM), feature-sliced folders checked by Steiger | ✅ | `src/` layers, `steiger.config.ts` (clean), `src-tauri/`; every widget reads a `use*` view-model hook in its `model/` |
| G2 | **Real LVGL preview**: LVGL 9.6 compiled to wasm, rendering the canvas pixel-for-pixel at RGB565, with input | ✅ | `runtime/`, `src/shared/lvgl/runtime.ts`; `compile.test.ts` taps a button on the wasm LVGL and watches the screen load |
| G3 | **Figma-style editing**: infinite canvas of screens, layers, insert, select/move/resize with smart guides, auto-layout reorder, undo/redo, copy/paste, groups, in-place text, components, save/open | ✅ | `widgets/canvas`, `widgets/layers-panel`, `features/node-actions`, `features/components`, `features/project-file` |
| G4 | **Web-like styling**: CSS-like props per part and state (incl. state combos), flexbox auto layout, shared styles (classes), colour tokens, theme | ✅ | `widgets/inspector`, `shared/ui/StyleProps.tsx`, `widgets/styles-panel` |
| G5 | **Web-like animation**: CSS-style transitions on state changes; keyframe timelines with cubic-bezier easing, delay, repeat, alternate; autoplay or triggered | ✅ | `compile.ts` (timelines, mirrored alternate, transitions), `widgets/timeline`, `kiln_helpers.c` |
| G6 | **Variables and bindings**: LVGL subjects bound to text, values, checked, visibility, state, mapped style props, chart history; simulated in Play | ✅ | `BindTab.tsx`, `DataPanel.tsx`, `ProjectPlayer`, kitchen-sink test |
| G7 | **Interactions and Play**: events → navigate (screen transitions), set/step/toggle variables, play animations; Play runs it all on real LVGL | ✅ | `InteractTab.tsx`, `widgets/player` |
| G8 | **PlatformIO hookups**: board catalog from PlatformIO's board definitions, MCU pin maps and checks, display presets, variables fed from ADC/digital/sensors and driving pins, memory budget | ✅ | `entities/board`, `widgets/board-dialog`, `DataPanel.tsx`; budget calibrated against a real build |
| G9 | **LVGL export**: clean LVGL 9.6 C plus a PlatformIO project for ESP32-C3 that compiles; never overwrites the user's code | ✅ | `features/export-firmware`; clang checks fail on deprecated API; `pio run` on esp32-c3-devkitm-1: sample and kitchen sink both build with no warnings from generated code |
| G10 | **Build and flash from the app**: run `pio run` / upload with streamed logs | 🟡 | `src-tauri/src/pio.rs`, `widgets/export-dialog`. The build path is tested end to end: `builds_an_exported_project` runs the real `pio_run` command on an export and checks the streamed log ends in SUCCESS. Upload is the same command with `-t upload` and hasn't met a board yet |
| G11 | **Images**: import PNG/JPG, convert to LVGL formats (RGB565 / RGB565A8 / ARGB8888) with optional Bayer dithering | ✅ | `features/import-image` (tested), `widgets/assets-panel` |
| G12 | **Quality**: tests for the compiler, runtime, export, canvas maths, image conversion, zip and Rust file writes; typecheck and Steiger clean; CI; README for Michael | ✅ | `pnpm check` (27 tests), `cargo test`, `.github/workflows/ci.yml` |

## Not done, on purpose or not yet

- **Real hardware.** Nothing has been flashed to a physical panel. The display config (inversion, red/blue, offsets) is all toggles, but expect to tune it once.
- **Custom fonts.** Only LVGL's built-in Montserrat and Unscii sizes. TTF import via LVGL's TinyTTF (same renderer on the canvas and the board) is the natural next step.
- **Multi-resolution projects.** One target display per project.
- **Align/distribute and marquee selection.** Multi-select works for move, group and delete only.
- **Animating inside instances.** Timelines target nodes; a track on a main component's child doesn't follow into its instances.

## Review log

- **Review 1, after the first milestone.** The `pio run` build surfaced LVGL 9.6 deprecations (`lv_subject_init_*`, `lv_obj_bind_*_if_*`, `lv_obj_add_flag`). The generated code moved to `lv_subject_create`, `lv_obj_set_hidden()` and friends, plus Kiln's own comparison binders, and the clang checks now treat deprecations as errors. Steiger caught an integration test reaching into another feature's internals; it moved to the `app` layer. The budget estimator was recalibrated against the real build (it had assumed the whole 4 MB chip instead of the 1.25 MB app partition).
- **Review 2, final.** See the findings applied in the last commits.
