import { useState } from "react"
import { editorApi, useEditorStore } from "@/entities/editor"
import { allNodes, edit, findNode, ttfUses, useProjectStore, type Asset, type FontAsset, type ImageFormat } from "@/entities/project"
import { importFonts } from "@/features/import-font"
import { bytesPerPixel, importImages, reconvert } from "@/features/import-image"
import { fontFamily } from "@/shared/lib/font-faces"
import { DEFAULT_FONT, parseTtfFont, ttfFont } from "@/shared/lvgl"

const isFont = (f: File) => /\.(ttf|otf|ttc)$/i.test(f.name)

/** Opens the file picker for `accept` and hands over what was chosen. */
function pickFiles(accept: string, then: (files: FileList) => unknown) {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = accept
  input.multiple = true
  input.onchange = () => input.files && then(input.files)
  input.click()
}

/** View-model for the assets panel: imported images and fonts, their formats, and where they're used. */
export function useAssets() {
  const project = useProjectStore(s => s.project)
  const selection = useEditorStore(s => s.selection)
  const [over, setOver] = useState(false)
  const selected = selection.length === 1 ? findNode(project, selection[0]) : undefined
  const nodes = allNodes(project)
  const ttf = ttfUses(project)

  return {
    assets: project.assets,
    over,
    imageTarget: selected?.widget === "image" ? selected : undefined,
    flashBytes: (a: Asset) => a.width * a.height * bytesPerPixel[a.format],
    usesOf: (a: Asset) => nodes.filter(n => n.props.src === a.id || Object.values(n.style).some(p => p.bg_image_src === a.id)).length,
    pick: () => pickFiles("image/png,image/jpeg,image/gif,image/webp,image/svg+xml", importImages),
    fonts: project.fonts,
    /** the selected layer, which "Use on" sets the font of */
    textTarget: selected && selected.widget !== "screen" ? selected : undefined,
    fontBytes: (f: FontAsset) => Math.ceil((f.data.length * 3) / 4),
    /** sizes the styles use this font at */
    fontSizes: (f: FontAsset) => ttf.filter(u => u.id === f.id).map(u => u.size),
    fontFamily: (f: FontAsset) => fontFamily(f.id, f.data),
    pickFonts: () => pickFiles(".ttf,.otf,.ttc,font/ttf,font/otf", importFonts),
    removeFont: (id: string) => edit(d => void (d.fonts = d.fonts.filter(f => f.id !== id))),
    /** sets a layer's text in this font, keeping the size it had */
    useFont: (fontId: string, nodeId: string) => {
      edit(d => {
        const n = allNodes(d).find(x => x.id === nodeId)
        if (!n) return
        const style = (n.style["main:default"] ??= {})
        const current = String(style.text_font ?? DEFAULT_FONT)
        style.text_font = ttfFont(fontId, parseTtfFont(current)?.size ?? Number(/(\d+)$/.exec(current)?.[1] ?? 14))
      })
      editorApi.getState().set({ rightTab: "design" })
    },
    dragOver: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(true)
    },
    dragLeave: () => setOver(false),
    drop: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      const files = Array.from(e.dataTransfer.files)
      importFonts(files.filter(isFont))
      importImages(files.filter(f => !isFont(f)))
    },
    remove: (id: string) => edit(d => void (d.assets = d.assets.filter(a => a.id !== id))),
    setFormat: (id: string, format: ImageFormat) => reconvert(id, { format }),
    setDither: (id: string, dither: boolean) => reconvert(id, { dither }),
    useIn: (assetId: string, nodeId: string) => {
      edit(d => {
        const n = allNodes(d).find(x => x.id === nodeId)
        if (n) n.props.src = assetId
      })
      editorApi.getState().set({ rightTab: "design" })
    },
  }
}
