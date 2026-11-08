import { editorApi } from "@/entities/editor"
import { build, stopBuild, toggleMonitor, toggleOutput } from "@/features/export-firmware"
import {
  closeActive,
  newProject,
  openProject,
  saveProject,
  showHome,
} from "@/features/project-file"
import { useSettings } from "@/shared/config"
import { inTauri } from "@/shared/lib/tauri"

/** What each item of the native menu bar does (src-tauri/src/menu.rs sends its id). */
export const MENU: Record<string, () => unknown> = {
  "settings": () => editorApi.getState().set({ dialog: "settings" }),
  "home": showHome,
  "new": () => newProject("blank"),
  "close-tab": closeActive,
  "open": openProject,
  "save": () => saveProject(),
  "save-as": () => saveProject(true),
  "output": toggleOutput,
  "timeline": () => editorApi.getState().set({ timelineOpen: !editorApi.getState().timelineOpen }),
  "pixel-grid": () =>
    useSettings.getState().update({ pixelGrid: !useSettings.getState().pixelGrid }),
  "board": () => editorApi.getState().set({ dialog: "board" }),
  "export": () => editorApi.getState().set({ dialog: "export" }),
  "build": () => build(false),
  "flash": () => build(true),
  "stop": stopBuild,
  "monitor": toggleMonitor,
  "shortcuts": () => editorApi.getState().set({ dialog: "shortcuts" }),
}

/** Runs menu bar items in the editor. Returns the cleanup. */
export function startMenu() {
  if (!inTauri()) return
  let stop: (() => void) | undefined
  let gone = false
  import("@tauri-apps/api/event").then(async ({ listen }) => {
    const un = await listen<string>("menu", e => MENU[e.payload]?.())
    if (gone) un()
    else stop = un
  })
  return () => {
    gone = true
    stop?.()
  }
}
