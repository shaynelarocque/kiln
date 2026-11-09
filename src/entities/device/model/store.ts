import { create } from "zustand"
import {
  deviceApi,
  type Job,
  type JobEvent,
  type MonitorEvent,
  type MonitorInfo,
  type PortInfo,
} from "../api/device-api"
import { splitLines, uploadProgress } from "../lib/log"
import { parseTrace, type Trace } from "../lib/trace"

/** Lines of serial output the monitor keeps on screen. */
const MONITOR_LINES = 3000
/** kiln-debug traces kept for replays and timings. */
const TRACES = 3000
const PORT_KEY = "kiln.port"

const savedPort = () => {
  try {
    return localStorage.getItem(PORT_KEY) ?? ""
  } catch {
    return ""
  }
}

type DeviceState = {
  /** the running or last build */
  job: Job | null
  log: string[]
  /** esptool's upload progress, 0-1, while it writes */
  progress: number | null
  /** when the current job started, for its duration */
  startedAt: number | null
  finishedAt: number | null
  monitor: MonitorInfo | null
  /** serial output, as complete lines plus the line still arriving */
  lines: string[]
  partial: string
  /** what a kiln-debug build reported, parsed from those lines */
  traces: Trace[]
  /** traces ever received: tells a listener how many of `traces` are new */
  traceCount: number
  ports: PortInfo[]
  /** the port to upload to and monitor; "" lets PlatformIO find the board */
  port: string
  setPort: (port: string) => void
  refreshPorts: () => Promise<void>
}

export const useDevice = create<DeviceState>()(set => ({
  job: null,
  log: [],
  progress: null,
  startedAt: null,
  finishedAt: null,
  monitor: null,
  lines: [],
  partial: "",
  traces: [],
  traceCount: 0,
  ports: [],
  port: savedPort(),
  setPort: port => {
    set({ port })
    try {
      localStorage.setItem(PORT_KEY, port)
    } catch {
      // the choice just lasts the session
    }
  },
  refreshPorts: async () => {
    if (!deviceApi.available()) return
    try {
      set({ ports: await deviceApi.ports() })
    } catch {
      set({ ports: [] })
    }
  },
}))

export const deviceStore = useDevice

function onJob(e: JobEvent) {
  if (e.kind === "start")
    return useDevice.setState({
      job: e.job,
      log: [],
      progress: null,
      startedAt: Date.now(),
      finishedAt: null,
    })
  if (e.kind === "done")
    return useDevice.setState({ job: e.job, progress: null, finishedAt: Date.now() })
  const progress = uploadProgress(e.text)
  useDevice.setState(s => ({
    log: s.log.length > 4000 ? [...s.log.slice(-3000), e.text] : [...s.log, e.text],
    progress: progress ?? s.progress,
  }))
}

function onMonitor(e: MonitorEvent) {
  if (e.kind === "state") return useDevice.setState({ monitor: e.monitor })
  useDevice.setState(s => {
    const { lines, partial } = splitLines(s.partial, e.text)
    if (!lines.length) return { partial }
    const all = s.lines.concat(lines)
    const traces = lines.map(parseTrace).filter(t => t !== null)
    const kept = traces.length ? s.traces.concat(traces).slice(-TRACES) : s.traces
    return {
      lines: all.length > MONITOR_LINES ? all.slice(-MONITOR_LINES) : all,
      partial,
      traces: kept,
      traceCount: s.traceCount + traces.length,
    }
  })
}

// the other window picked a port
if (typeof window !== "undefined")
  window.addEventListener(
    "storage",
    e => e.key === PORT_KEY && useDevice.setState({ port: e.newValue ?? "" }),
  )

let started = false

/**
 * Follows builds and the serial monitor in this window. They run in the app, not the page, so
 * a window that opens late first catches up on what it missed.
 */
export async function startDevice() {
  if (started || !deviceApi.available()) return
  started = true
  await deviceApi.listen<JobEvent>("job", onJob)
  await deviceApi.listen<MonitorEvent>("monitor", onMonitor)
  const [jobs, monitor] = await Promise.all([deviceApi.jobState(), deviceApi.monitorState()])
  const { lines, partial } = splitLines("", monitor.text)
  useDevice.setState({
    job: jobs.job,
    log: jobs.log,
    monitor: monitor.monitor,
    lines: lines.slice(-MONITOR_LINES),
    partial,
  })
  useDevice.getState().refreshPorts()
}

/** Clears the monitor's text here and in the app's backlog. */
export function clearMonitor() {
  useDevice.setState({ lines: [], partial: "" })
  if (deviceApi.available()) deviceApi.monitorClear()
}
