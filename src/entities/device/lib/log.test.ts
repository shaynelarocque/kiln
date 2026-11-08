import { describe, expect, it } from "vitest"
import { splitLines, toneOf, uploadProgress } from "./log"

describe("board and build logs", () => {
  it("joins serial chunks into lines, whatever the line endings", () => {
    let state = splitLines("", "LVGL st")
    expect(state).toEqual({ lines: [], partial: "LVGL st" })
    state = splitLines(state.partial, "arted\r\nheap: 61")
    expect(state).toEqual({ lines: ["LVGL started"], partial: "heap: 61" })
    state = splitLines(state.partial, " KB\n")
    expect(state).toEqual({ lines: ["heap: 61 KB"], partial: "" })
  })

  it("drops terminal colour codes", () => {
    expect(splitLines("", "\x1b[0;32mI (312) boot: ok\x1b[0m\n").lines).toEqual([
      "I (312) boot: ok",
    ])
  })

  it("reads esptool's progress", () => {
    expect(uploadProgress("Writing at 0x000c24c2... (86 %)")).toBe(0.86)
    expect(uploadProgress("Compiling .pio/build/main.o")).toBeNull()
  })

  it("tells errors, warnings and success apart", () => {
    expect(toneOf("src/ui/ui.c:12:3: error: unknown type name")).toBe("error")
    expect(toneOf("E (123) spi: bus busy")).toBe("error")
    expect(toneOf("[Warn]\t(1.2, +3)\t lv_mem: low")).toBe("warn")
    expect(toneOf("========== [SUCCESS] Took 14.93 seconds ==========")).toBe("good")
    expect(toneOf("Hash of data verified.")).toBe("good")
    expect(toneOf("Linking .pio/build/firmware.elf")).toBeNull()
  })
})
