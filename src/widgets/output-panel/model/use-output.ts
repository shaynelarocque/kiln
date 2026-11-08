import { useEffect, useState } from "react"
import { clearMonitor, deviceApi, useDevice, type Job } from "@/entities/device"
import { editorApi, useEditorStore, type OutputTab } from "@/entities/editor"
import { build, stopBuild, toggleMonitor } from "@/features/export-firmware"
import { useSettings } from "@/shared/config"

export const BAUDS = [9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600]

/** Runs a menu command in the editor window, which holds the project. */
async function askEditor(id: string) {
  const { emitTo } = await import("@tauri-apps/api/event")
  await emitTo("main", "menu", id)
}

const folderName = (dir: string) => dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir

/** "Flashing Beermagochi · 45%", "Built in 14.9 s", "Build failed (exit 1)". */
function describe(job: Job | null, progress: number | null, ms: number | null) {
  if (!job) return { text: "Nothing built yet", tone: "idle" as const }
  const name = folderName(job.dir)
  const upload = job.kind === "upload"
  if (job.running)
    return {
      text:
        progress !== null
          ? `Flashing ${name} · ${Math.round(progress * 100)}%`
          : `${upload ? "Building and flashing" : "Building"} ${name}…`,
      tone: "running" as const,
    }
  const took = ms !== null ? ` in ${(ms / 1000).toFixed(1)} s` : ""
  if (job.stopped) return { text: "Stopped", tone: "idle" as const }
  if (job.code === 0)
    return { text: `${upload ? "Flashed" : "Built"} ${name}${took}`, tone: "good" as const }
  return { text: `${upload ? "Flash" : "Build"} failed (exit ${job.code})`, tone: "error" as const }
}

/**
 * View-model for the build log and serial monitor. `docked` is the panel under the canvas;
 * otherwise this is the output window, which keeps its own tab.
 */
export function useOutput(docked: boolean) {
  const device = useDevice()
  const dockTab = useEditorStore(s => s.outputTab)
  const [windowTab, setWindowTab] = useState<OutputTab>("build")
  const tab = docked ? dockTab : windowTab
  const setTab = (t: OutputTab) =>
    docked ? editorApi.getState().set({ outputTab: t }) : setWindowTab(t)
  const baud = useSettings(s => s.baud)
  const [draft, setDraft] = useState("")

  // the editor asks the output window for a tab when it starts a build or the monitor
  useEffect(() => {
    if (docked || !deviceApi.available()) return
    let stop: (() => void) | undefined
    import("@tauri-apps/api/event").then(async ({ listen }) => {
      stop = await listen<OutputTab>("output-tab", e => setWindowTab(e.payload))
    })
    return () => stop?.()
  }, [docked])

  const running = Boolean(device.job?.running)
  const monitorOpen = Boolean(device.monitor && device.monitor.status !== "closed")
  const ms = device.startedAt && device.finishedAt ? device.finishedAt - device.startedAt : null

  return {
    available: deviceApi.available(),
    docked,
    tab,
    setTab,
    job: device.job,
    log: device.log,
    progress: device.progress,
    status: describe(device.job, device.progress, ms),
    running,
    // the editor has the project: from the output window, ask it to build
    build: () => (docked ? build(false) : askEditor("build")),
    flash: () => (docked ? build(true) : askEditor("flash")),
    stop: stopBuild,
    ports: device.ports,
    port: device.port,
    setPort: device.setPort,
    refreshPorts: device.refreshPorts,
    monitor: device.monitor,
    monitorOpen,
    lines: device.lines,
    partial: device.partial,
    baud,
    setBaud: async (b: number) => {
      useSettings.getState().update({ baud: b })
      // reopen at the new speed
      if (monitorOpen && device.monitor) await deviceApi.monitorOpen(device.monitor.port, b)
    },
    toggleMonitor,
    reset: () => deviceApi.monitorReset().catch(() => {}),
    clear: () => (tab === "monitor" ? clearMonitor() : useDevice.setState({ log: [] })),
    draft,
    setDraft,
    send: async () => {
      if (!draft) return
      await deviceApi
        .monitorSend(`${draft}\n`)
        .catch(e => useDevice.setState(s => ({ lines: [...s.lines, `(not sent: ${e})`] })))
      setDraft("")
    },
    popOut: async () => {
      useSettings.getState().update({ output: "window" })
      editorApi.getState().set({ outputOpen: false })
      await deviceApi.openOutputWindow()
    },
    close: () => editorApi.getState().set({ outputOpen: false }),
  }
}

export type OutputViewModel = ReturnType<typeof useOutput>
