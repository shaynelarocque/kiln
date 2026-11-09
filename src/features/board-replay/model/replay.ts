import { deviceApi, deviceStore, type Trace } from "@/entities/device"
import { projectApi } from "@/entities/project"
import { stepCommand, type Step } from "../lib/steps"
import { timingsOf, type Timings } from "../lib/timings"

export type StepResult = { step: Step; ok: boolean; error?: string }
export type Replay = { results: StepResult[]; traces: Trace[] } & Timings

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** The traces that arrive from now on, until stop(). */
function collect() {
  const traces: Trace[] = []
  let seen = deviceStore.getState().traceCount
  const stop = deviceStore.subscribe(s => {
    const fresh = s.traceCount - seen
    if (fresh > 0) traces.push(...s.traces.slice(-fresh))
    seen = s.traceCount
  })
  return { traces, stop }
}

/** The first trace from `from` on that matches, or null after `ms`. */
async function waitFor(traces: Trace[], from: number, match: (t: Trace) => boolean, ms: number) {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(20)) {
    const hit = traces.slice(from).find(match)
    if (hit) return hit
  }
  return null
}

/** Waits until every animation and screen change the run started has finished (3 s at most). */
async function settle(traces: Trace[], ms: number) {
  await sleep(ms)
  const open = () => {
    const going = new Map<string, number>()
    for (const t of traces) {
      const key = t.kind === "anim" ? `a:${t.name}` : t.kind === "scr" ? `s:${t.screen}` : null
      if (!key) continue
      const starts =
        (t.kind === "anim" && t.what === "start") || (t.kind === "scr" && t.what === "load")
      const ends =
        (t.kind === "anim" && t.what === "done") || (t.kind === "scr" && t.what === "loaded")
      if (starts) going.set(key, (going.get(key) ?? 0) + 1)
      if (ends) going.set(key, Math.max(0, (going.get(key) ?? 0) - 1))
    }
    return [...going.values()].some(n => n > 0)
  }
  for (const until = Date.now() + 3000; open() && Date.now() < until;) await sleep(50)
}

/**
 * Runs a replay on the board through kiln-debug (it needs a Debug build, and the serial monitor
 * connected): each step's command, waiting for the board's answer; then what it all measured.
 * Stops at the first step the board refuses.
 */
export async function replayOnBoard(steps: Step[]): Promise<Replay> {
  if (!deviceApi.available()) throw new Error("Replays on the board need Kiln's desktop app")
  if (deviceStore.getState().monitor?.status !== "connected")
    throw new Error("Connect the serial monitor to the board first (⇧⌘M)")
  const { traces, stop } = collect()
  const send = (command: string) => deviceApi.monitorSend(`${command}\n`)
  try {
    await send("@K ping")
    if (!(await waitFor(traces, 0, t => t.kind === "pong", 2000)))
      throw new Error(
        "No answer from kiln-debug. Is the board running a Debug build? Turn on Settings › Debug builds, then Flash.",
      )
    const results: StepResult[] = []
    for (const step of steps) {
      const command = stepCommand(step)
      if (!command) {
        await sleep((step as { wait: number }).wait)
        results.push({ step, ok: true })
        continue
      }
      const from = traces.length
      await send(command.command)
      const answer = await waitFor(
        traces,
        from,
        t => t.kind === "err" || ((t.kind === "ok" || t.kind === "mark") && t.text === command.ok),
        ("hold" in step ? step.ms : 0) + 3000,
      )
      if (!answer || answer.kind === "err") {
        results.push({
          step,
          ok: false,
          error: answer?.kind === "err" ? answer.text : "The board didn't answer",
        })
        break
      }
      results.push({ step, ok: true })
    }
    await settle(traces, 300)
    return { results, traces: [...traces], ...timingsOf(projectApi.getState().project, traces) }
  } finally {
    stop()
  }
}
