import { describe, expect, it } from "vitest"
import { convert, hasAlpha, toBase64 } from "./convert"

const px = (...rgba: number[]) => new Uint8Array(rgba)

describe("image conversion", () => {
  it("packs RGB565 little-endian", () => {
    // pure red, green, blue, white
    const { data, stride } = convert(px(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255), 4, 1, "RGB565", false)
    expect(stride).toBe(8)
    expect([...data]).toEqual([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0xff, 0xff])
  })

  it("puts alpha in its own plane for RGB565A8", () => {
    const { data } = convert(px(255, 255, 255, 128, 0, 0, 0, 0), 2, 1, "RGB565A8", false)
    expect([...data]).toEqual([0xff, 0xff, 0x00, 0x00, 128, 0])
  })

  it("stores ARGB8888 as BGRA", () => {
    expect([...convert(px(1, 2, 3, 4), 1, 1, "ARGB8888", false).data]).toEqual([3, 2, 1, 4])
  })

  it("dithers a flat mid-grey into a mix of neighbouring levels, keeping the average", () => {
    const w = 4
    const grey = new Uint8Array(w * w * 4).map((_, i) => (i % 4 === 3 ? 255 : 100))
    const { data } = convert(grey, w, w, "RGB565", true)
    const reds = new Set<number>()
    let sum = 0
    for (let i = 0; i < w * w; i++) {
      const r = ((data[i * 2] | (data[i * 2 + 1] << 8)) >> 11) << 3
      reds.add(r)
      sum += r
    }
    expect(reds.size).toBeGreaterThan(1)
    expect(Math.abs(sum / (w * w) - 100)).toBeLessThan(4)
  })

  it("spots transparency and round-trips base64", () => {
    expect(hasAlpha(px(0, 0, 0, 255))).toBe(false)
    expect(hasAlpha(px(0, 0, 0, 254))).toBe(true)
    expect(atob(toBase64(px(0, 255, 7)))).toBe("\x00\xff\x07")
  })
})
