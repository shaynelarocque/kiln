import { describe, expect, it } from "vitest"
import { BUNDLED_BOARDS, findBoard } from "@/entities/board"
import { createSampleProject } from "@/entities/project"
import { generateFirmware } from "@/features/export-firmware"

describe("exporting a hostile project", () => {
  it("keeps every injected value out of the generated sources", () => {
    const p = createSampleProject()
    p.name = 'x */ int evil; /*\n[env]\nupload_command = touch /tmp/pwned'
    p.tokens[0].value = "#000000); evil(); //"
    p.theme.primary = "#fff); evil(); //"
    p.screens[0].style["main:default"].bg_color = "#000000); evil(); //"
    p.screens[0].style["main:default"].text_align = "LV_TEXT_ALIGN_CENTER); evil(); //"
    p.screens[0].style["main:default"]["bg_color); evil(); //"] = 1
    p.target.display.pins.sck = "6; evil()" as unknown as number
    const files = generateFirmware(p, findBoard(BUNDLED_BOARDS, p.target.board))
    // injected text may survive inside a comment, harmlessly, but never as code or config
    const code = files
      .filter(f => /\.(c|h|cpp|hpp)$/.test(f.path))
      .map(f => f.content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))
      .join("\n")
    expect(code).not.toContain("evil")
    const ini = files.find(f => f.path === "platformio.ini")!.content
    expect(ini.split("\n").filter(l => !l.startsWith(";")).join("\n")).not.toMatch(/upload_command|evil/)
  })

  it("won't write an ini for an invalid board id", () => {
    const p = createSampleProject()
    p.target.board = "x\n[env]"
    expect(() => generateFirmware(p, undefined)).toThrow(/board id/)
  })
})
