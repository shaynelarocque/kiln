import { describe, expect, it } from "vitest"
import { BUNDLED_BOARDS, findBoard } from "@/entities/board"
import { createSampleProject } from "@/entities/project"
import { generateFirmware } from "@/features/export-firmware"

describe("exporting a hostile project", () => {
  it("keeps every injected value out of the generated sources", () => {
    const p = createSampleProject()
    p.name = "x */ int evil; /*\n[env]\nupload_command = touch /tmp/pwned"
    p.tokens[0].value = "#000000); evil(); //"
    p.theme.primary = "#fff); evil(); //"
    p.screens[0].style["main:default"].bg_color = "#000000); evil(); //"
    p.screens[0].style["main:default"].text_align = "LV_TEXT_ALIGN_CENTER); evil(); //"
    p.screens[0].style["main:default"]["bg_color); evil(); //"] = 1
    p.target.display.pins.sck = "6; evil()" as unknown as number
    // imported fonts: a value or an id that tries to break out of the ttf:<id>:<px> form
    p.fonts.push(
      { id: "f1", name: "font", data: btoa("\0\x01\0\0") },
      { id: "f2); evil(); //", name: "font", data: btoa("\0\x01\0\0") },
    )
    p.screens[0].style["main:default"].text_font = "ttf:f1:16); evil(); //"
    p.screens[0].children[0].style["main:default"] = { text_font: "ttf:f2); evil(); //:16" }
    const files = generateFirmware(p, findBoard(BUNDLED_BOARDS, p.target.board))
    // injected text may survive inside a comment, harmlessly, but never as code or config
    const code = files
      .filter(f => /\.(c|h|cpp|hpp)$/.test(f.path))
      .map(f => f.content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))
      .join("\n")
    expect(code).not.toContain("evil")
    const ini = files.find(f => f.path === "kiln.ini")!.content
    expect(
      ini
        .split("\n")
        .filter(l => !l.startsWith(";"))
        .join("\n"),
    ).not.toMatch(/upload_command|evil/)
  })

  it("won't write an ini for an invalid board id", () => {
    const p = createSampleProject()
    p.target.board = "x\n[env]"
    expect(() => generateFirmware(p, undefined)).toThrow(/board id/)
  })
})
