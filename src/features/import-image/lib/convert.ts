import type { ImageFormat } from "@/entities/project"

/** 4×4 Bayer matrix: ordered dithering hides RGB565's banding on gradients. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

export const bytesPerPixel: Record<ImageFormat, number> = { RGB565: 2, RGB565A8: 3, ARGB8888: 4 }

/**
 * RGBA pixels → LVGL 9 image data. RGB565 is little-endian; RGB565A8 is the RGB565 plane
 * followed by an alpha plane; ARGB8888 is stored B, G, R, A. `stride` is the colour plane's row size.
 */
export function convert(
  rgba: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  format: ImageFormat,
  dither: boolean,
) {
  if (format === "ARGB8888") {
    const data = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = rgba[i * 4 + 2]
      data[i * 4 + 1] = rgba[i * 4 + 1]
      data[i * 4 + 2] = rgba[i * 4]
      data[i * 4 + 3] = rgba[i * 4 + 3]
    }
    return { data, stride: w * 4 }
  }
  const alpha = format === "RGB565A8"
  const data = new Uint8Array(w * h * (alpha ? 3 : 2))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      // centre the threshold on 0 so dithering doesn't brighten the image
      const t = dither ? BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5 : 0
      const q = (v: number, step: number) => Math.min(255, Math.max(0, Math.round(v + t * step)))
      const a = rgba[i * 4 + 3] / 255
      // without an alpha plane, transparent pixels go black, like LVGL's own converter
      const k = alpha ? 1 : a
      const r = q(rgba[i * 4] * k, 8) >> 3
      const g = q(rgba[i * 4 + 1] * k, 4) >> 2
      const b = q(rgba[i * 4 + 2] * k, 8) >> 3
      const px = (r << 11) | (g << 5) | b
      data[i * 2] = px & 0xff
      data[i * 2 + 1] = px >> 8
      if (alpha) data[w * h * 2 + i] = rgba[i * 4 + 3]
    }
  return { data, stride: w * 2 }
}

export const hasAlpha = (rgba: Uint8Array | Uint8ClampedArray) =>
  rgba.some((v, i) => i % 4 === 3 && v < 255)
