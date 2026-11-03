import { toBase64 } from "@/shared/lib/base64"
import { pngDataUrl } from "@/shared/lib/png"
import { newId } from "./factory"
import type { Sprite } from "./types"

/** One frame of pixel art being drawn: RGBA, where each stroke replaces what was under it. */
class Frame {
  readonly rgba: Uint8Array
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.rgba = new Uint8Array(w * h * 4)
  }

  px(x: number, y: number, color: string, alpha = 255) {
    const [px, py] = [Math.round(x), Math.round(y)]
    if (px < 0 || py < 0 || px >= this.w || py >= this.h || alpha <= 0) return
    const i = (py * this.w + px) * 4
    for (let c = 0; c < 3; c++) this.rgba[i + c] = parseInt(color.slice(1 + c * 2, 3 + c * 2), 16)
    this.rgba[i + 3] = Math.min(255, Math.round(alpha))
  }
}

/** Frames as a Kiln sprite in ARGB8888 (LVGL's B, G, R, A), each with its PNG for the editor. */
function sprite(name: string, frameMs: number, frames: Frame[]): Sprite {
  const { w, h } = frames[0]
  const bgra = (rgba: Uint8Array) => {
    const out = new Uint8Array(rgba.length)
    for (let i = 0; i < rgba.length; i += 4)
      out.set([rgba[i + 2], rgba[i + 1], rgba[i], rgba[i + 3]], i)
    return out
  }
  return {
    id: newId(),
    name,
    width: w,
    height: h,
    format: "ARGB8888",
    dither: false,
    frameMs,
    stride: w * 4,
    frames: frames.map(f => ({ png: pngDataUrl(w, h, f.rgba), data: toBase64(bgra(f.rgba)) })),
  }
}

const GOLD = "#ffd166"
const MINT = "#7ee0b5"
const GLOW = "#fff3c4"

/** A four-point star: 0 is gone, 1 a dot, then longer arms, with diagonal glints from 3. */
function star(f: Frame, cx: number, cy: number, size: number) {
  if (size === 0) return
  if (size === 1) return f.px(cx, cy, GLOW)
  for (let d = 1; d < size; d++)
    for (const [dx, dy] of [
      [d, 0],
      [-d, 0],
      [0, d],
      [0, -d],
    ])
      f.px(cx + dx, cy + dy, d === size - 1 ? MINT : GOLD)
  if (size >= 3)
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      f.px(cx + dx, cy + dy, GLOW, 190)
  f.px(cx, cy, "#ffffff")
}

/** Two stars twinkling out of step: the pet's sober sparkle. */
export function sparkleSprite() {
  const sizes = [0, 1, 2, 3, 4, 3, 2, 1]
  const frames = sizes.map((_, i) => {
    const f = new Frame(24, 24)
    star(f, 7, 8, sizes[i])
    star(f, 17, 16, sizes[(i + 4) % sizes.length])
    return f
  })
  return sprite("sparkle", 120, frames)
}

/** A bubble of radius 1-3: a pale ring round a see-through middle, with a glint. */
function bubble(f: Frame, x: number, y: number, r: number) {
  const [cx, cy] = [Math.round(x), Math.round(y)]
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy)
      if (d <= r - 0.5) f.px(cx + dx, cy + dy, "#9fd8ff", 70)
      else if (d <= r + 0.5) f.px(cx + dx, cy + dy, "#d8f3ff")
    }
  f.px(cx - Math.ceil(r / 2), cy - Math.ceil(r / 2), "#ffffff")
}

/** What's left of a bubble the frame it pops: a ring of droplets. */
function pop(f: Frame, x: number, y: number, r: number) {
  const [cx, cy] = [Math.round(x), Math.round(y)]
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const reach = dx && dy ? r : r + 1
      f.px(cx + dx * reach, cy + dy * reach, "#d8f3ff", dx && dy ? 160 : 255)
    }
}

/** Hiccups: three bubbles rise, wobble, grow and pop, a beat apart. */
export function bubbleSprite() {
  const n = 8
  const bubbles = [
    { x: 5, phase: 0 },
    { x: 10, phase: 3 },
    { x: 7, phase: 6 },
  ]
  const frames = Array.from({ length: n }, (_, i) => {
    const f = new Frame(16, 24)
    for (const b of bubbles) {
      const step = (i + b.phase) % n
      const t = step / n
      const r = t < 0.25 ? 1 : t < 0.6 ? 2 : 3
      const x = b.x + Math.sin(t * Math.PI * 2) * 1.5
      const y = 21 - t * 18
      if (step === n - 1) pop(f, x, y, r)
      else bubble(f, x, y, r)
    }
    return f
  })
  return sprite("hiccup_bubbles", 110, frames)
}

const Z = [
  ["###", ".#.", "###"],
  ["####", "..#.", ".#..", "####"],
  ["#####", "...#.", "..#..", ".#...", "#####"],
]

/** "zzz": three letters drift up and away, growing as they go, fading in and out. */
export function zzzSprite() {
  const n = 8
  const frames = Array.from({ length: n }, (_, i) => {
    const f = new Frame(24, 24)
    for (let k = 0; k < 3; k++) {
      const t = ((i + (k * n) / 3) % n) / n
      const glyph = Z[t < 0.34 ? 0 : t < 0.67 ? 1 : 2]
      const [x, y] = [2 + t * 15, 17 - t * 15]
      const alpha = 255 * Math.min(1, t / 0.15, (1 - t) / 0.2)
      // a drop shadow keeps them readable on any background
      for (const [color, off] of [
        ["#4b3fa8", 1],
        ["#d9ccff", 0],
      ] as const)
        glyph.forEach((row, gy) =>
          [...row].forEach((c, gx) => c === "#" && f.px(x + gx + off, y + gy + off, color, alpha)),
        )
    }
    return f
  })
  return sprite("zzz", 170, frames)
}
