import { Channel, invoke } from "@/shared/lib/tauri"
import type { FirmwareFile } from "../lib/firmware"

export type RunEvent = { kind: "line"; text: string } | { kind: "done"; code: number }
export type SerialPort = { port: string; description: string; hwid: string }

export const pioInfo = () => invoke<{ path: string | null; version: string | null }>("pio_info")

export const pioPorts = async () => JSON.parse(await invoke<string>("pio_devices")) as SerialPort[]

/** Writes the project into `dir`; files marked overwrite: false are left alone if they exist. */
export const writeProject = (dir: string, files: FirmwareFile[]) =>
  invoke<string[]>("write_project", { dir, files })

/** `pio run` (or upload) in `dir`, streaming each output line to `onEvent`. Resolves with the exit code. */
export function pioRun(
  dir: string,
  upload: boolean,
  port: string | null,
  onEvent: (e: RunEvent) => void,
) {
  const channel = new Channel<RunEvent>()
  channel.onmessage = onEvent
  return invoke<number>("pio_run", { dir, upload, port, onEvent: channel })
}

export async function pickFolder() {
  const { open } = await import("@tauri-apps/plugin-dialog")
  const dir = await open({ directory: true, title: "Export the PlatformIO project to…" })
  return typeof dir === "string" ? dir : null
}
