import { invoke } from "@/shared/lib/tauri"
import type { FirmwareFile } from "../lib/firmware"

export const pioInfo = () => invoke<{ path: string | null; version: string | null }>("pio_info")

/** Writes the project into `dir`; files marked overwrite: false are left alone if they exist. */
export const writeProject = (dir: string, files: FirmwareFile[]) =>
  invoke<string[]>("write_project", { dir, files })

export async function pickFolder() {
  const { open } = await import("@tauri-apps/plugin-dialog")
  const dir = await open({ directory: true, title: "Export the PlatformIO project to…" })
  return typeof dir === "string" ? dir : null
}
