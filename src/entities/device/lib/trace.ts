/**
 * kiln-debug's traces: the "@K <ms> <what> …" lines a Debug build prints over serial (the
 * protocol is written out in runtime/kiln_debug.cpp). `ms` is the board's millis().
 */
export type Trace = { ms: number } & (
  | { kind: "ready"; protocol: number; screen: string }
  | { kind: "ev"; what: "press" | "release" | "click" | "long" | "value"; layer: string }
  | { kind: "scr"; what: "load" | "loaded" | "unload" | "unloaded"; screen: string }
  | { kind: "anim"; what: "start"; playtime: number; delay: number; name: string }
  | { kind: "anim"; what: "done"; name: string }
  | { kind: "var"; name: string; value: string }
  | { kind: "frames"; count: number; averageUs: number; longestUs: number }
  | { kind: "ok" | "err" | "mark"; text: string }
  | { kind: "pong" }
)

export const isTraceLine = (line: string) => line.startsWith("@K ")

const EVENTS = ["press", "release", "click", "long", "value"]
const SCREENS = ["load", "loaded", "unload", "unloaded"]

/** One serial line as a trace, or null when it's something else (the app's own logging). */
export function parseTrace(line: string): Trace | null {
  const m = /^@K (\d+) (\S+)(?: (.*))?$/.exec(line.trimEnd())
  if (!m) return null
  const ms = Number(m[1])
  const kind = m[2]
  const rest = m[3] ?? ""
  // names come last, and may hold spaces
  const [first, ...more] = rest.split(" ")
  const after = more.join(" ")
  switch (kind) {
    case "ready":
      return { ms, kind, protocol: Number(first), screen: after }
    case "ev":
      return EVENTS.includes(first) ? { ms, kind, what: first as "press", layer: after } : null
    case "scr":
      return SCREENS.includes(first) ? { ms, kind, what: first as "load", screen: after } : null
    case "anim": {
      if (first === "done") return { ms, kind, what: "done", name: after }
      const s = /^start (\d+) (\d+) (.*)$/.exec(rest)
      return s
        ? { ms, kind, what: "start", playtime: Number(s[1]), delay: Number(s[2]), name: s[3] }
        : null
    }
    case "var":
      return { ms, kind, name: first, value: after }
    case "frames": {
      const [count, average, longest] = rest.split(" ").map(Number)
      return [count, average, longest].every(Number.isFinite)
        ? { ms, kind, count, averageUs: average, longestUs: longest }
        : null
    }
    case "ok":
    case "err":
    case "mark":
      return { ms, kind, text: rest }
    case "pong":
      return { ms, kind }
    default:
      return null
  }
}
