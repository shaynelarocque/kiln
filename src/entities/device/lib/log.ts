/** Terminal colour codes, which ESP-IDF and some Arduino logs print. */
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

export const stripAnsi = (text: string) => text.replace(ANSI, "")

export type Tone = "error" | "warn" | "good" | "trace" | null

/** How a line of build output or board log reads at a glance. */
export function toneOf(line: string): Tone {
  // kiln-debug's own lines: quieter than the app's logging, except its errors
  if (line.startsWith("@K ")) return /^@K \d+ err /.test(line) ? "error" : "trace"
  if (
    /\b(error|failed|fatal)\b|^E \(\d+\)|\[E\]|\[Error\]|Guru Meditation|abort\(\)/i.test(line) &&
    !/\b0 errors?\b/i.test(line)
  )
    return "error"
  if (/\bwarning\b|^W \(\d+\)|\[W\]|\[Warn\]/i.test(line)) return "warn"
  if (/\[SUCCESS\]|Hash of data verified|^Wrote \d+ bytes/.test(line)) return "good"
  return null
}

/** esptool's "Writing at 0x… (86 %)", as 0-1. */
export function uploadProgress(line: string): number | null {
  const m = /^Writing at 0x[0-9a-f]+\.*\s*\((\d+)\s*%\)/i.exec(line)
  return m ? Number(m[1]) / 100 : null
}

/**
 * Serial text arrives in chunks that split lines anywhere. Joins a chunk onto what came before:
 * the complete lines, and the start of the next one.
 */
export function splitLines(partial: string, chunk: string) {
  const parts = (partial + stripAnsi(chunk)).replace(/\r\n?/g, "\n").split("\n")
  return { lines: parts.slice(0, -1), partial: parts.at(-1)! }
}
