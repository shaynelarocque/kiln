import { describe, expect, it } from "vitest"
import { decodeGif } from "./gif"

/** GIF's LZW as encoders write it: the code size grows one code after the decoder's table fills. */
function lzw(indices: number[], minCodeSize: number) {
  const clear = 1 << minCodeSize
  let size = minCodeSize + 1
  let next = clear + 2
  const dict = new Map<string, number>()
  const bytes: number[] = []
  let acc = 0
  let bits = 0
  const emit = (code: number) => {
    acc |= code << bits
    bits += size
    for (; bits >= 8; bits -= 8, acc >>>= 8) bytes.push(acc & 255)
  }
  const code = (s: string) => (s.includes(",") ? dict.get(s)! : Number(s))
  emit(clear)
  let w = String(indices[0])
  for (const k of indices.slice(1)) {
    const wk = `${w},${k}`
    if (dict.has(wk)) {
      w = wk
      continue
    }
    emit(code(w))
    dict.set(wk, next++)
    if (next > 1 << size && size < 12) size++
    w = String(k)
  }
  emit(code(w))
  emit(clear + 1)
  if (bits) bytes.push(acc & 255)
  return bytes
}

type Frame = {
  indices: number[]
  delay?: number
  transparent?: number
  disposal?: number
  rect?: [number, number, number, number]
  interlace?: boolean
}

/** A GIF89a with a global palette, one graphic control extension per frame. */
function gif(width: number, height: number, palette: number[][], frames: Frame[]) {
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length)))
  const out = [...Array.from("GIF89a", c => c.charCodeAt(0))]
  const u16 = (v: number) => out.push(v & 255, v >> 8)
  u16(width)
  u16(height)
  out.push(0x80 | (bits - 1), 0, 0)
  for (let i = 0; i < 1 << bits; i++) out.push(...(palette[i] ?? [0, 0, 0]))
  for (const f of frames) {
    const [x, y, w, h] = f.rect ?? [0, 0, width, height]
    out.push(0x21, 0xf9, 4, ((f.disposal ?? 0) << 2) | (f.transparent === undefined ? 0 : 1))
    u16((f.delay ?? 100) / 10)
    out.push(f.transparent ?? 0, 0, 0x2c)
    ;[x, y, w, h].forEach(u16)
    out.push(f.interlace ? 0x40 : 0)
    const min = Math.max(2, bits)
    const data = lzw(f.indices, min)
    out.push(min)
    for (let i = 0; i < data.length; i += 255)
      out.push(Math.min(255, data.length - i), ...data.slice(i, i + 255))
    out.push(0)
  }
  out.push(0x3b)
  return new Uint8Array(out)
}

const RED = [255, 0, 0]
const GREEN = [0, 255, 0]
const BLUE = [0, 0, 255]
const WHITE = [255, 255, 255]
const pixel = (rgba: Uint8ClampedArray, i: number) => [...rgba.subarray(i * 4, i * 4 + 4)]

describe("decoding GIFs", () => {
  it("composes each frame with its delay", () => {
    const { width, height, frames } = decodeGif(
      gif(
        2,
        2,
        [RED, GREEN, BLUE, WHITE],
        [{ indices: [0, 1, 2, 3] }, { indices: [3, 3, 3, 3], delay: 250 }],
      ),
    )
    expect([width, height, frames.length]).toEqual([2, 2, 2])
    expect([0, 1, 2, 3].map(i => pixel(frames[0].rgba, i))).toEqual([
      [...RED, 255],
      [...GREEN, 255],
      [...BLUE, 255],
      [...WHITE, 255],
    ])
    expect(frames.map(f => f.delay)).toEqual([100, 250])
  })

  it("keeps what transparent pixels and smaller frames don't cover, then disposes", () => {
    const { frames } = decodeGif(
      gif(
        2,
        2,
        [RED, GREEN, BLUE, WHITE],
        [
          { indices: [0, 0, 0, 0] },
          // just the bottom-right pixel, cleared again before the next frame
          { indices: [1], rect: [1, 1, 1, 1], disposal: 2 },
          // all transparent, and restored to what was there before it
          { indices: [3, 3, 3, 3], transparent: 3, disposal: 3 },
          { indices: [2], rect: [0, 0, 1, 1] },
        ],
      ),
    )
    expect(pixel(frames[1].rgba, 3)).toEqual([...GREEN, 255])
    expect(pixel(frames[1].rgba, 0)).toEqual([...RED, 255])
    expect(pixel(frames[2].rgba, 3)).toEqual([0, 0, 0, 0])
    expect([pixel(frames[3].rgba, 0), pixel(frames[3].rgba, 1)]).toEqual([
      [...BLUE, 255],
      [...RED, 255],
    ])
  })

  it("puts interlaced rows back in order", () => {
    // stored as rows 0, 4, 2, 6, 1, 3, 5, 7; row r should come out in colour r % 4
    const stored = [0, 4, 2, 6, 1, 3, 5, 7].map(r => r % 4)
    const { frames } = decodeGif(
      gif(1, 8, [RED, GREEN, BLUE, WHITE], [{ indices: stored, interlace: true }]),
    )
    const palette = [RED, GREEN, BLUE, WHITE]
    expect([...Array(8).keys()].map(r => pixel(frames[0].rgba, r))).toEqual(
      [...Array(8).keys()].map(r => [...palette[r % 4], 255]),
    )
  })

  it("decodes long runs and busy images, where codes outgrow their size", () => {
    const runs = Array(256).fill(1)
    const busy = Array.from({ length: 4096 }, (_, i) => (i * 7 + (i >> 5)) % 16)
    const palette = Array.from({ length: 16 }, (_, i) => [i * 16, 255 - i * 16, i * 8])
    for (const [w, h, indices] of [
      [16, 16, runs],
      [64, 64, busy],
    ] as const) {
      const { frames } = decodeGif(gif(w, h, palette, [{ indices: [...indices] }]))
      const got = Array.from({ length: w * h }, (_, i) =>
        palette.findIndex(c => c.every((v, k) => v === frames[0].rgba[i * 4 + k])),
      )
      expect(got).toEqual([...indices])
    }
  })

  it("says what's wrong with a file that isn't one", () => {
    expect(() => decodeGif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toThrow(
      /isn't a GIF/,
    )
    expect(() =>
      decodeGif(gif(2, 2, [RED, GREEN], [{ indices: [0, 1, 0, 1] }]).subarray(0, 30)),
    ).toThrow()
  })
})
