import { Channel, invoke } from "@tauri-apps/api/core"

/** True inside the Tauri shell; false when the UI runs in a plain browser (pnpm dev). */
export const inTauri = () => "__TAURI_INTERNALS__" in window

export { Channel, invoke }

/** A yes/no question: Tauri's native dialog in the app (WKWebView's confirm() isn't reliable), confirm() in a browser. */
export async function confirmAction(message: string) {
  if (!inTauri()) return window.confirm(message)
  const { ask } = await import("@tauri-apps/plugin-dialog")
  return ask(message, { title: "Kiln", kind: "warning" })
}
