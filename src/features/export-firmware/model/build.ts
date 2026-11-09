import { boardsApi, findBoard } from "@/entities/board"
import { deviceApi, deviceStore } from "@/entities/device"
import { editorApi, nodeBoxes, type OutputTab } from "@/entities/editor"
import { projectApi } from "@/entities/project"
import { useSettings } from "@/shared/config"
import { pickFolder, writeProject } from "../api/firmware-api"
import { generateFirmware, type FirmwareFile } from "../lib/firmware"

/** Each size builds for its own board and panel, so each remembers its own folder. */
const folderKey = (name: string, size: string | null) =>
  `kiln:export:${name}${size ? `@${size}` : ""}`

/** Where the open project (at the size being edited) was last exported, if anywhere. */
export function exportFolder() {
  const { project, size } = projectApi.getState()
  try {
    return localStorage.getItem(folderKey(project.name, size))
  } catch {
    return null
  }
}

/** The firmware for the open project as it stands, at the size being edited. */
export function currentFirmware() {
  const { project } = projectApi.getState()
  const board = findBoard(boardsApi.getState().boards, project.target.board)
  return generateFirmware(project, board, nodeBoxes(editorApi.getState().rects))
}

/** Writes the project into `dir` and remembers it as the project's folder. */
export async function exportTo(dir: string, files: FirmwareFile[] = currentFirmware()) {
  const written = await writeProject(dir, files)
  const { project, size } = projectApi.getState()
  try {
    localStorage.setItem(folderKey(project.name, size), dir)
  } catch {
    // the folder is just asked for again next time
  }
  return { written: written.length, kept: files.length - written.length }
}

/** Shows the build log or the serial monitor where Settings says: docked, or in its own window. */
export async function showOutput(tab?: OutputTab) {
  if (useSettings.getState().output === "window" && deviceApi.available()) {
    await deviceApi.openOutputWindow()
    if (tab) {
      const { emitTo } = await import("@tauri-apps/api/event")
      await emitTo("output", "output-tab", tab)
    }
    return
  }
  editorApi.getState().set({ outputOpen: true, ...(tab && { outputTab: tab }) })
}

/** Toggles the docked output, or brings up its window. */
export function toggleOutput() {
  const { outputOpen, set } = editorApi.getState()
  if (outputOpen) set({ outputOpen: false })
  else showOutput()
}

const fail = (what: string, e: unknown) =>
  editorApi.getState().set({ error: `${what}: ${e instanceof Error ? e.message : e}` })

/**
 * Exports the project and runs PlatformIO on it in the background (with `upload`, flashing the
 * board too). The editor stays usable; the log streams into the output panel or window. The
 * first time, it asks where the project goes. `debug` makes kiln-debug's Debug build (Settings
 * says by default).
 */
export async function build(upload: boolean, debug = useSettings.getState().debugBuild) {
  if (!deviceApi.available()) return
  if (deviceStore.getState().job?.running) return showOutput("build")
  const dir = exportFolder() ?? (await pickFolder())
  if (!dir) return
  try {
    await exportTo(dir)
  } catch (e) {
    return fail("Export failed", e)
  }
  await showOutput("build")
  try {
    await deviceApi.jobStart(dir, upload, deviceStore.getState().port || null, debug)
  } catch (e) {
    fail("Couldn't start PlatformIO", e)
  }
}

export const stopBuild = () => deviceApi.available() && deviceApi.jobStop()

/** The port the monitor should use: the chosen one, or the first USB device. */
async function monitorPort() {
  const device = deviceStore.getState()
  if (device.port) return device.port
  await device.refreshPorts()
  return deviceStore.getState().ports.find(p => p.usb)?.port ?? null
}

/** Opens the serial monitor at the chosen speed, or closes it if it's open. */
export async function toggleMonitor() {
  if (!deviceApi.available()) return
  const { monitor } = deviceStore.getState()
  if (monitor && monitor.status !== "closed") return deviceApi.monitorClose()
  await openMonitor()
}

export async function openMonitor() {
  if (!deviceApi.available()) return
  await showOutput("monitor")
  const port = await monitorPort()
  if (!port) return fail("Serial monitor", "no board found. Plug one in or pick its port.")
  try {
    await deviceApi.monitorOpen(port, useSettings.getState().baud)
  } catch (e) {
    fail("Serial monitor", e)
  }
}
