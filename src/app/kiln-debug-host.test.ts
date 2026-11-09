import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect, it } from "vitest"
import { BUNDLED_BOARDS, findBoard } from "@/entities/board"
import { parseTrace, type Trace } from "@/entities/device"
import { createSampleProject } from "@/entities/project"
import { timingsOf } from "@/features/board-replay"
import { generateFirmware } from "@/features/export-firmware"

const runtime = new URL("../../runtime", import.meta.url).pathname
const lvgl = join(runtime, "lvgl")

// Compiles LVGL natively (a minute or so), so it runs when asked: KILN_HOST_TESTS=1 pnpm test
it.runIf(process.env.KILN_HOST_TESTS && existsSync(lvgl))(
  "kiln-debug traces and replays the exported UI, compiled as a board would",
  () => {
    const project = createSampleProject()
    const dir = mkdtempSync(join(tmpdir(), "kiln-debug-"))
    for (const f of generateFirmware(project, findBoard(BUNDLED_BOARDS, project.target.board))) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true })
      writeFileSync(join(dir, f.path), f.content)
    }
    execFileSync(join(runtime, "kiln-debug-host/build.sh"), [dir, join(dir, "host")], {
      stdio: "pipe",
    })
    const out = execFileSync(
      join(dir, "host/kd-host"),
      ["@K ping", "@K tap settings_button", "@K set target 24", "@K tap nope"],
      { encoding: "utf8" },
    )
    const traces = out
      .split("\n")
      .map(parseTrace)
      .filter(t => t !== null) as Trace[]
    const find = (pred: (t: Trace) => boolean) => traces.find(pred)
    expect(find(t => t.kind === "ready")).toMatchObject({ protocol: 1, screen: "Home" })
    expect(find(t => t.kind === "pong")).toBeTruthy()
    expect(find(t => t.kind === "ok" && t.text === "tap settings_button")).toBeTruthy()
    expect(
      find(t => t.kind === "ev" && t.what === "click" && t.layer === "settings_button"),
    ).toBeTruthy()
    expect(find(t => t.kind === "var" && t.name === "target" && t.value === "24")).toBeTruthy()
    expect(find(t => t.kind === "err")).toMatchObject({ text: "there's no layer nope" })
    // the 300 ms transition the design asks for, measured on LVGL's own clock
    const settings = timingsOf(project, traces).timings.find(t => t.name === "Settings")
    expect(settings).toMatchObject({ kind: "transition", designed: 300, measured: 300 })
  },
  300_000,
)
