import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { zip } from "./zip"

it("writes a zip that unzip accepts, UTF-8 names and all", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kiln-zip-")), "out.zip")
  writeFileSync(
    path,
    zip([
      { path: "platformio.ini", content: "[env:x]\n" },
      { path: "src/ui/ui.c", content: "/* °C */\n" },
      { path: "src/ui/data.bin", content: new Uint8Array([0, 1, 2, 255]) },
    ]),
  )
  expect(execFileSync("unzip", ["-t", path], { encoding: "utf8" })).toMatch(/No errors detected/)
  expect(execFileSync("unzip", ["-p", path, "src/ui/ui.c"], { encoding: "utf8" })).toBe(
    "/* °C */\n",
  )
})
