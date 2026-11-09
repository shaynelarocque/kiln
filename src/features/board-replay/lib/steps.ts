/**
 * A replay: what to do to the UI, step by step, by layer name. The same steps run in Play mode
 * and, through kiln-debug, on the board. Written as text, one step a line:
 *
 *   load Home
 *   tap settings_button
 *   wait 500
 *   hold 700 eco_switch
 *   set target 24
 *   mark opened settings
 */
export type Step =
  | { tap: string }
  | { hold: string; ms: number }
  | { set: string; value: string }
  | { load: string }
  | { wait: number }
  | { mark: string }

export function formatSteps(steps: Step[]) {
  return steps
    .map(s =>
      "tap" in s
        ? `tap ${s.tap}`
        : "hold" in s
          ? `hold ${s.ms} ${s.hold}`
          : "set" in s
            ? `set ${s.set} ${s.value}`
            : "load" in s
              ? `load ${s.load}`
              : "wait" in s
                ? `wait ${s.wait}`
                : `mark ${s.mark}`,
    )
    .join("\n")
}

/** Text back to steps; throws on a line it can't read, saying which. */
export function parseSteps(text: string): Step[] {
  const steps: Step[] = []
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith("#")) return
    const [verb, ...rest] = line.split(/\s+/)
    const arg = rest.join(" ")
    const bad = (what: string) => new Error(`Line ${i + 1}: ${what}`)
    switch (verb) {
      case "tap":
      case "load":
      case "mark":
        if (!arg) throw bad(`${verb} needs a name`)
        steps.push({ [verb]: arg } as Step)
        break
      case "hold": {
        const ms = Number(rest[0])
        if (!Number.isFinite(ms) || rest.length < 2) throw bad("write hold <ms> <layer>")
        steps.push({ hold: rest.slice(1).join(" "), ms })
        break
      }
      case "set":
        if (rest.length < 2) throw bad("write set <variable> <value>")
        steps.push({ set: rest[0], value: rest.slice(1).join(" ") })
        break
      case "wait": {
        const ms = Number(arg)
        if (!Number.isFinite(ms) || ms < 0) throw bad("write wait <ms>")
        steps.push({ wait: ms })
        break
      }
      default:
        throw bad(`there's no step "${verb}" (tap, hold, set, load, wait, mark)`)
    }
  })
  return steps
}

/** The kiln-debug command for a step, and the "ok" it answers with; null for a wait. */
export function stepCommand(step: Step): { command: string; ok: string } | null {
  if ("wait" in step) return null
  if ("tap" in step) return { command: `@K tap ${step.tap}`, ok: `tap ${step.tap}` }
  if ("hold" in step)
    return { command: `@K hold ${Math.round(step.ms)} ${step.hold}`, ok: `hold ${step.hold}` }
  if ("set" in step) return { command: `@K set ${step.set} ${step.value}`, ok: `set ${step.set}` }
  if ("load" in step) return { command: `@K load ${step.load}`, ok: `load ${step.load}` }
  return { command: `@K mark ${step.mark}`, ok: step.mark }
}
