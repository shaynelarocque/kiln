import { describe, expect, it } from "vitest"
import {
  createEmptyProject,
  createPetProject,
  createSampleProject,
  DEFAULT_DISPLAY,
  type Target,
} from "@/entities/project"
import { withHardware } from "./hardware"

/** A GC9A01 tuned for a real module: slower clock, other pins, a panel offset. */
const tuned: Target = {
  board: "lolin_c3_mini",
  display: {
    ...DEFAULT_DISPLAY,
    spiMHz: 20,
    offsetX: 2,
    pins: { sck: 2, mosi: 3, cs: 4, dc: 5, rst: 6, bl: 7 },
  },
  buttons: [{ id: "b", name: "Next", pin: 9, activeLow: true, key: "next" }],
}

describe("new projects on the saved hardware", () => {
  it("leaves projects alone when nothing was saved", () => {
    const p = createSampleProject()
    expect(withHardware(p, false, null)).toBe(p)
  })

  it("gives a sample on the same panel every setting, SPI clock included", () => {
    const p = withHardware(createSampleProject(), false, tuned)
    expect(p.target).toEqual(tuned)
    expect(p.target).not.toBe(tuned)
  })

  it("keeps a size made for another panel, moving only its board, wiring and clock", () => {
    const p = withHardware(createPetProject(), false, tuned)
    const small = p.sizes[0].target
    expect(small.display.driver).toBe("st7735")
    expect(small.display.width).toBe(128)
    expect(small.display.offsetX).toBe(0)
    expect(small.display.spiMHz).toBe(20)
    expect(small.display.pins).toEqual(tuned.display.pins)
    expect(small.board).toBe("lolin_c3_mini")
  })

  it("resizes a blank project's screens to the saved panel", () => {
    const st7789 = {
      ...tuned,
      display: { ...tuned.display, driver: "st7789" as const, width: 320, height: 240 },
    }
    const p = withHardware(createEmptyProject(), true, st7789)
    expect(p.target.display.driver).toBe("st7789")
    expect(p.screens.every(s => s.layout.w === 320 && s.layout.h === 240)).toBe(true)
  })
})
