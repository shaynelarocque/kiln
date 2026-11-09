import wasmUrl from "./runtime/kiln-rt.wasm?url"
import { LvglRuntime } from "./runtime"

let current: Promise<LvglRuntime> | null = null
const listeners = new Set<() => void>()

/** The app's one LVGL instance. LVGL keeps global state, so everything shares it. */
export const getRuntime = () => (current ??= LvglRuntime.load(wasmUrl))

/** An LVGL instance of its own, for work that mustn't touch the canvas's (MCP's screenshots). */
export const loadRuntime = () => LvglRuntime.load(wasmUrl)

/**
 * After a trap LVGL's state can't be trusted (a trap inside lv_timer_handler even leaves it
 * locked): start over with a fresh instance, and tell everyone holding the old one.
 */
export const resetRuntime = () => {
  current = null
  listeners.forEach(fn => fn())
}

/** Called whenever the runtime is replaced; returns an unsubscribe function. */
export const onRuntimeReset = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
