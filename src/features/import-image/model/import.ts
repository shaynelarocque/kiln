import { editorApi } from "@/entities/editor"
import {
  edit,
  newId,
  projectApi,
  slug,
  type Asset,
  type ImageFormat,
  type Sprite,
} from "@/entities/project"
import { toBase64 } from "@/shared/lib/base64"
import { decodeGif } from "@/shared/lib/gif"
import { convert, hasAlpha } from "../lib/convert"
import { byNumberedName, stripFrames } from "../lib/frames"

type Picture = { w: number; h: number; rgba: Uint8ClampedArray; png: string }

/** Draws (part of) a source onto a canvas, scaled to fit `max` pixels on its longer side. */
function fit(source: CanvasImageSource, [sx, sy, sw, sh]: number[], max: number): Picture {
  const scale = Math.min(1, max / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!
  // pixel art stays pixel art when it doesn't need shrinking
  ctx.imageSmoothingEnabled = scale < 1
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h)
  return { w, h, rgba: ctx.getImageData(0, 0, w, h).data, png: canvas.toDataURL("image/png") }
}

const bitmapOf = async (source: Blob | string) =>
  createImageBitmap(typeof source === "string" ? await (await fetch(source)).blob() : source)

/** Decodes an image (file or data: URL) to RGBA, scaled down to fit `max` pixels on its longer side. */
async function decode(source: Blob | string, max: number) {
  const bitmap = await bitmapOf(source)
  return fit(bitmap, [0, 0, bitmap.width, bitmap.height], max)
}

const isGif = (f: File) => f.type === "image/gif" || /\.gif$/i.test(f.name)

/** A GIF's frames, composed by Kiln's own decoder (WebKit has no ImageDecoder for GIFs). */
async function gifFrames(file: File, max: number) {
  const { width, height, frames } = decodeGif(new Uint8Array(await file.arrayBuffer()))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  const pictures = frames.map(f => {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), width, height), 0, 0)
    return fit(canvas, [0, 0, width, height], max)
  })
  const frameMs = Math.round(frames.reduce((sum, f) => sum + f.delay, 0) / frames.length)
  return { pictures, frameMs }
}

/** Adds image files as LVGL assets, scaled to fit the display. */
export async function importImages(files: FileList | File[]) {
  const { target } = projectApi.getState().project
  const max = Math.max(target.display.width, target.display.height)
  for (const file of Array.from(files)) {
    try {
      const { w, h, rgba, png } = await decode(file, max)
      const format: ImageFormat = hasAlpha(rgba) ? "RGB565A8" : "RGB565"
      const { data, stride } = convert(rgba, w, h, format, false)
      const asset: Asset = {
        id: newId(),
        name: slug(file.name.replace(/\.\w+$/, "")),
        width: w,
        height: h,
        format,
        dither: false,
        png,
        data: toBase64(data),
        stride,
      }
      edit(d => void d.assets.push(asset))
    } catch (e) {
      editorApi
        .getState()
        .set({ error: `Couldn't import ${file.name}: ${e instanceof Error ? e.message : e}` })
    }
  }
}

/** Re-converts an asset from its stored source after a format or dithering change. */
export async function reconvert(id: string, patch: { format?: ImageFormat; dither?: boolean }) {
  const asset = projectApi.getState().project.assets.find(a => a.id === id)
  if (!asset) return
  const format = patch.format ?? asset.format
  const dither = patch.dither ?? asset.dither
  const { rgba } = await decode(asset.png, Math.max(asset.width, asset.height))
  const { data, stride } = convert(rgba, asset.width, asset.height, format, dither)
  edit(d => {
    const a = d.assets.find(x => x.id === id)
    if (a) Object.assign(a, { format, dither, data: toBase64(data), stride })
  })
}

/**
 * Adds a frame animation, ready for a Sprite widget: an animated GIF, a strip of square frames,
 * or several images in the order their names number them. Each frame is converted like an image.
 */
export async function importAnimation(files: FileList | File[]) {
  const list = byNumberedName(Array.from(files))
  const first = list[0]
  if (!first) return
  const { target } = projectApi.getState().project
  const max = Math.max(target.display.width, target.display.height)
  try {
    let pictures: Picture[]
    let frameMs = 100
    if (list.length === 1 && isGif(first)) ({ pictures, frameMs } = await gifFrames(first, max))
    else if (list.length === 1) {
      const bitmap = await bitmapOf(first)
      const strip = stripFrames(bitmap.width, bitmap.height)
      pictures = Array.from({ length: strip.count }, (_, i) =>
        strip.count === 1
          ? fit(bitmap, [0, 0, bitmap.width, bitmap.height], max)
          : fit(
              bitmap,
              strip.across
                ? [i * strip.size, 0, strip.size, strip.size]
                : [0, i * strip.size, strip.size, strip.size],
              max,
            ),
      )
    } else {
      // every frame at the first one's size
      const bitmaps = await Promise.all(list.map(f => bitmapOf(f)))
      const size = fit(bitmaps[0], [0, 0, bitmaps[0].width, bitmaps[0].height], max)
      pictures = bitmaps.map(b => fitTo(b, size.w, size.h))
    }
    const { w, h } = pictures[0]
    const format: ImageFormat = pictures.some(p => hasAlpha(p.rgba)) ? "RGB565A8" : "RGB565"
    const converted = pictures.map(p => convert(p.rgba, w, h, format, false))
    const sprite: Sprite = {
      id: newId(),
      name: slug(first.name.replace(/\.\w+$/, "").replace(/[-_ ]?\d+$/, "")),
      width: w,
      height: h,
      format,
      dither: false,
      frameMs,
      stride: converted[0].stride,
      frames: pictures.map((p, i) => ({ png: p.png, data: toBase64(converted[i].data) })),
    }
    edit(d => void d.sprites.push(sprite))
    return sprite.id
  } catch (e) {
    editorApi
      .getState()
      .set({ error: `Couldn't import ${first.name}: ${e instanceof Error ? e.message : e}` })
  }
}

/** One more frame for a sequence: drawn to the first frame's size. */
function fitTo(source: ImageBitmap, w: number, h: number): Picture {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!
  ctx.imageSmoothingEnabled = source.width > w
  ctx.drawImage(source, 0, 0, w, h)
  return { w, h, rgba: ctx.getImageData(0, 0, w, h).data, png: canvas.toDataURL("image/png") }
}

/** Re-converts every frame of a sprite after a format or dithering change. */
export async function reconvertSprite(
  id: string,
  patch: { format?: ImageFormat; dither?: boolean },
) {
  const sprite = projectApi.getState().project.sprites.find(s => s.id === id)
  if (!sprite) return
  const format = patch.format ?? sprite.format
  const dither = patch.dither ?? sprite.dither
  const pictures = await Promise.all(
    sprite.frames.map(f => decode(f.png, Math.max(sprite.width, sprite.height))),
  )
  const converted = pictures.map(p => convert(p.rgba, sprite.width, sprite.height, format, dither))
  edit(d => {
    const s = d.sprites.find(x => x.id === id)
    if (!s) return
    Object.assign(s, { format, dither, stride: converted[0].stride })
    s.frames.forEach((f, i) => (f.data = toBase64(converted[i].data)))
  })
}
