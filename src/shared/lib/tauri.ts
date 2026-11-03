import { Channel, invoke } from "@tauri-apps/api/core"

/** True inside the Tauri shell; false when the UI runs in a plain browser (pnpm dev). */
export const inTauri = () => "__TAURI_INTERNALS__" in window

export { Channel, invoke }
