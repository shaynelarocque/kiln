import { Channel, invoke } from "@tauri-apps/api/core"

/** True inside the Tauri shell; false when the UI runs in a plain browser (pnpm dev). */
export const inTauri = () => "__TAURI_INTERNALS__" in window

export { Channel, invoke }

/** This window's Tauri label ("main", "output"), or null in a browser. */
export function windowLabel(): string | null {
  const internals = (
    window as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }
  ).__TAURI_INTERNALS__
  return internals?.metadata?.currentWindow?.label ?? null
}

/** macOS, where closing the last window leaves the app running. */
export const onMac = () => /Mac/.test(navigator.userAgent)

/** A yes/no question: Tauri's native dialog in the app (WKWebView's confirm() isn't reliable), confirm() in a browser. */
export async function confirmAction(message: string) {
  if (!inTauri()) return window.confirm(message)
  const { ask } = await import("@tauri-apps/plugin-dialog")
  return ask(message, { title: "Kiln", kind: "warning" })
}
