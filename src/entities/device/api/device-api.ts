import { inTauri, invoke } from "@/shared/lib/tauri"

/** A `pio run` in an exported project: a build, or a build and upload. */
export type Job = {
  kind: "build" | "upload"
  dir: string
  port: string | null
  running: boolean
  /** exit code once done; -1 when stopped */
  code: number | null
  stopped: boolean
}

export type JobEvent =
  { kind: "start"; job: Job } | { kind: "line"; text: string } | { kind: "done"; job: Job }

export type MonitorStatus = "connected" | "waiting" | "paused" | "closed"
export type MonitorInfo = {
  port: string
  baud: number
  status: MonitorStatus
  error: string | null
}
export type MonitorEvent = { kind: "state"; monitor: MonitorInfo } | { kind: "data"; text: string }

export type PortInfo = { port: string; description: string; usb: boolean }

export const deviceApi = {
  available: inTauri,
  jobStart: (dir: string, upload: boolean, port: string | null) =>
    invoke<void>("job_start", { dir, upload, port }),
  jobStop: () => invoke<void>("job_stop"),
  jobState: () => invoke<{ job: Job | null; log: string[] }>("job_state"),
  ports: () => invoke<PortInfo[]>("serial_ports"),
  monitorOpen: (port: string, baud: number) => invoke<void>("monitor_open", { port, baud }),
  monitorClose: () => invoke<void>("monitor_close"),
  monitorClear: () => invoke<void>("monitor_clear"),
  monitorSend: (text: string) => invoke<void>("monitor_send", { text }),
  monitorReset: () => invoke<void>("monitor_reset"),
  monitorState: () => invoke<{ monitor: MonitorInfo | null; text: string }>("monitor_state"),
  openOutputWindow: () => invoke<void>("open_output_window"),
  /** Lets the app ask before quitting with unsaved work. */
  setDirty: (value: boolean) => invoke<void>("set_dirty", { value }),
  async listen<T>(event: "job" | "monitor", on: (payload: T) => void) {
    const { listen } = await import("@tauri-apps/api/event")
    return listen<T>(event, e => on(e.payload))
  },
}
