import { editorApi } from "@/entities/editor"
import { edit, newId, projectApi, slug, type Asset, type ImageFormat } from "@/entities/project"
import { toBase64 } from "@/shared/lib/base64"
import { convert, hasAlpha } from "../lib/convert"

/** Decodes an image (file or data: URL) to RGBA, scaled down to fit `max` pixels on its longer side. */
async function decode(source: Blob | string, max: number) {
  const blob = typeof source === "string" ? await (await fetch(source)).blob() : source
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0, w, h)
  return { w, h, rgba: ctx.getImageData(0, 0, w, h).data, png: canvas.toDataURL("image/png") }
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
      const asset: Asset = { id: newId(), name: slug(file.name.replace(/\.\w+$/, "")), width: w, height: h, format, dither: false, png, data: toBase64(data), stride }
      edit(d => void d.assets.push(asset))
    } catch (e) {
      editorApi.getState().set({ error: `Couldn't import ${file.name}: ${e instanceof Error ? e.message : e}` })
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
