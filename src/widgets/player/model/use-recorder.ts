import { useRef, useState } from "react"
import { deviceApi, deviceStore } from "@/entities/device"
import { allNodes, type Project, type ProjectPlayer } from "@/entities/project"
import {
  describeTimings,
  formatSteps,
  parseSteps,
  replayOnBoard,
  type Step,
} from "@/features/board-replay"
import { openMonitor } from "@/features/export-firmware"

/** A press this long or longer is a long press, as LVGL counts it. */
const LONG_PRESS = 400
const round = (ms: number) => Math.round(ms / 50) * 50

type ReplayState = { running: boolean; lines: string[]; error: string | null }

/**
 * Records what's done in Play mode as replay steps (taps by layer name, the waits between them,
 * variables set from the sidebar), and replays them on the board through kiln-debug.
 */
export function useRecorder(project: Project, player: React.RefObject<ProjectPlayer | null>) {
  const [recording, setRecording] = useState(false)
  const [script, setScript] = useState<string | null>(null)
  const [count, setCount] = useState(0)
  const [replay, setReplay] = useState<ReplayState | null>(null)
  const rec = useRef<{ steps: Step[]; last: number; down: { layer: string; at: number } | null }>({
    steps: [],
    last: 0,
    down: null,
  })
  const nameOf = (id: string | null | undefined) =>
    id ? allNodes(project).find(n => n.id === id)?.name : undefined

  /** A step, after the pause since the last one. */
  const add = (step: Step, at: number) => {
    const gap = round(at - rec.current.last)
    if (gap >= 100) rec.current.steps.push({ wait: gap })
    rec.current.steps.push(step)
    rec.current.last = performance.now()
    setCount(rec.current.steps.length)
  }

  return {
    recording,
    stepCount: count,
    script,
    setScript,
    replay,
    canReplay: deviceApi.available(),
    start: () => {
      // from the screen showing, so a replay starts where this did
      const screen = nameOf(player.current?.activeScreen())
      rec.current = { steps: screen ? [{ load: screen }] : [], last: performance.now(), down: null }
      setCount(rec.current.steps.length)
      setRecording(true)
      setReplay(null)
    },
    stop: () => {
      setRecording(false)
      setScript(formatSteps(rec.current.steps))
    },
    /** Pointer down in display pixels: which layer it lands on. */
    down: (x: number, y: number) => {
      if (!recording) return
      const layer = nameOf(player.current?.layerAt(x, y))
      rec.current.down = layer ? { layer, at: performance.now() } : null
    },
    up: () => {
      const down = rec.current.down
      if (!recording || !down) return
      rec.current.down = null
      const held = performance.now() - down.at
      add(held >= LONG_PRESS ? { hold: down.layer, ms: round(held) } : { tap: down.layer }, down.at)
    },
    set: (variableId: string, value: number) => {
      const v = project.variables.find(x => x.id === variableId)
      if (recording && v) add({ set: v.name, value: String(value) }, performance.now())
    },
    copy: () => script && navigator.clipboard.writeText(script),
    replayOnBoard: async () => {
      if (!script) return
      setReplay({ running: true, lines: [], error: null })
      try {
        const steps = parseSteps(script)
        if (deviceStore.getState().monitor?.status !== "connected") {
          await openMonitor()
          for (let i = 0; i < 30 && deviceStore.getState().monitor?.status !== "connected"; i++)
            await new Promise(r => setTimeout(r, 100))
        }
        const run = await replayOnBoard(steps)
        const failed = run.results.find(r => !r.ok)
        setReplay({
          running: false,
          lines: describeTimings(run),
          error: failed ? `Stopped at “${formatSteps([failed.step])}”: ${failed.error}` : null,
        })
      } catch (e) {
        setReplay({ running: false, lines: [], error: e instanceof Error ? e.message : String(e) })
      }
    },
  }
}
