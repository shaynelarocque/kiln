import type { Trace } from "@/entities/device"
import { allNodes, type Project } from "@/entities/project"

/** One thing that took time on the board, against what the design asked for. */
export type Timing = {
  kind: "transition" | "animation"
  name: string
  /** ms the design asks for, when Kiln knows */
  designed: number | null
  /** ms it took on the board */
  measured: number
  /** for a transition: ms from the tap that asked for it to the screen starting to change */
  latency?: number
}

export type FrameStats = { frames: number; averageMs: number; longestMs: number }

export type Timings = { timings: Timing[]; frames: FrameStats | null }

/**
 * What a run's traces say about timing: each screen transition and animation, measured on the
 * board and set against the design, and how long frames took to draw.
 */
export function timingsOf(project: Project, traces: Trace[]): Timings {
  const nodes = allNodes(project)
  const screens = project.screens
  const timings: Timing[] = []
  let lastClick: { ms: number; layer: string } | null = null
  const loads = new Map<string, { ms: number; designed: number | null; latency?: number }>()
  const anims = new Map<string, { ms: number; designed: number }>()
  let frames = 0
  let total = 0
  let longest = 0

  for (const t of traces) {
    if (t.kind === "ev" && t.what === "click") lastClick = { ms: t.ms, layer: t.layer }
    if (t.kind === "scr" && t.what === "load") {
      // the click that navigated here, if one did, says how long the transition should take
      const target = screens.find(s => s.name === t.screen)
      const from = lastClick && t.ms - lastClick.ms < 1000 ? lastClick : null
      const action = from
        ? nodes
            .find(n => n.name === from.layer)
            ?.events.find(e => e.action.type === "navigate" && e.action.screen === target?.id)
            ?.action
        : undefined
      loads.set(t.screen, {
        ms: t.ms,
        designed: action?.type === "navigate" ? action.duration + action.delay : from ? null : 0,
        ...(from && { latency: t.ms - from.ms }),
      })
    }
    if (t.kind === "scr" && t.what === "loaded") {
      const start = loads.get(t.screen)
      if (start) {
        timings.push({
          kind: "transition",
          name: t.screen,
          designed: start.designed,
          measured: t.ms - start.ms,
          ...(start.latency !== undefined && { latency: start.latency }),
        })
        loads.delete(t.screen)
      }
    }
    if (t.kind === "anim" && t.what === "start")
      anims.set(t.name, { ms: t.ms, designed: t.playtime + t.delay })
    if (t.kind === "anim" && t.what === "done") {
      const start = anims.get(t.name)
      if (start) {
        timings.push({
          kind: "animation",
          name: t.name,
          designed: start.designed,
          measured: t.ms - start.ms,
        })
        anims.delete(t.name)
      }
    }
    if (t.kind === "frames") {
      frames += t.count
      total += t.averageUs * t.count
      longest = Math.max(longest, t.longestUs)
    }
  }
  return {
    timings,
    frames: frames
      ? {
          frames,
          averageMs: Math.round(total / frames / 100) / 10,
          longestMs: Math.round(longest / 100) / 10,
        }
      : null,
  }
}

/** Timings as lines a person reads: "Settings: 300 ms designed, 342 ms on the board (+42)". */
export function describeTimings({ timings, frames }: Timings): string[] {
  const lines = timings.map(t => {
    const what = `${t.kind === "transition" ? "→ " : "▸ "}${t.name}`
    const off = t.designed !== null ? t.measured - t.designed : null
    const vs =
      t.designed !== null
        ? `${t.designed} ms designed, ${t.measured} ms on the board${off ? ` (${off > 0 ? "+" : ""}${off})` : ""}`
        : `${t.measured} ms on the board`
    return `${what}: ${vs}${t.latency !== undefined ? `; ${t.latency} ms after the tap` : ""}`
  })
  if (frames)
    lines.push(
      `Frames: ${frames.frames}, ${frames.averageMs} ms on average, the longest ${frames.longestMs} ms${frames.longestMs > 33 ? " (under 30 fps: animations will stutter)" : ""}`,
    )
  return lines
}
