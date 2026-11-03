import { expect, it } from "vitest"
import { estimateBudget } from "./budget"

/** An ESP32-C3 with a 240×240 panel and a modest UI. */
const c3 = {
  ram: 327680,
  rom: 1310720,
  width: 240,
  height: 240,
  bufferRows: 24,
  objects: 40,
  styleProps: 120,
  stringBytes: 400,
  fonts: [],
  ttfBytes: 0,
  ttfSizes: [],
  imageBytes: 0,
  widgetTypes: 8,
  layerBytes: 0,
}

it("never sizes LVGL's heap past what the board can hold, and says when it's short", () => {
  expect(estimateBudget(c3).heapShort).toBe(false)
  // a whole-screen rotated layer: more than a C3 has
  const big = estimateBudget({ ...c3, layerBytes: 250 * 1024 })
  expect(big.heapShort).toBe(true)
  // the static array stays inside the C3's link region (about 85% of its RAM, less the rest)
  expect(big.lvglHeap).toBeLessThanOrEqual(c3.ram * 0.85 - 2 * 240 * 24 * 2 - 64 * 1024)
  // and the meter still shows what the UI wanted
  expect(big.ram.used).toBeGreaterThan(c3.ram)
})
