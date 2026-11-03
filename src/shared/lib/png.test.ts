import { inflateSync } from "node:zlib"
import { expect, it } from "vitest"
import { pngDataUrl } from "./png"
import { crc32 } from "./zip"

it("writes a PNG any decoder reads: signature, checked chunks, RGBA scanlines", () => {
  const [w, h] = [300, 120]
  const rgba = Uint8Array.from({ length: w * h * 4 }, (_, i) => (i * 7) % 256)
  const png = Buffer.from(pngDataUrl(w, h, rgba).split(",")[1], "base64")
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const chunks: Record<string, Buffer> = {}
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at)
    const type = png.toString("latin1", at + 4, at + 8)
    const data = png.subarray(at + 8, at + 8 + length)
    expect(png.readUInt32BE(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)))
    chunks[type] = data
    at += 12 + length
  }
  expect(Object.keys(chunks)).toEqual(["IHDR", "IDAT", "IEND"])
  expect([
    chunks.IHDR.readUInt32BE(0),
    chunks.IHDR.readUInt32BE(4),
    chunks.IHDR[8],
    chunks.IHDR[9],
  ]).toEqual([w, h, 8, 6])
  // more than one stored block, and zlib's own checks (Adler-32 included) pass
  const raw = inflateSync(chunks.IDAT)
  for (let y = 0; y < h; y++) {
    expect(raw[y * (w * 4 + 1)]).toBe(0)
    expect(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1))).toEqual(
      Buffer.from(rgba.subarray(y * w * 4, (y + 1) * w * 4)),
    )
  }
})
