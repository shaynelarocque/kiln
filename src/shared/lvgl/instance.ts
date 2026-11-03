import wasmUrl from "./runtime/kiln-rt.wasm?url"
import { LvglRuntime } from "./runtime"

let current: Promise<LvglRuntime> | null = null

/** The app's one LVGL instance. LVGL keeps global state, so everything shares it. */
export const getRuntime = () => (current ??= LvglRuntime.load(wasmUrl))

/** After a trap LVGL's state can't be trusted: start over with a fresh instance. */
export const resetRuntime = () => {
  current = null
  return getRuntime()
}
