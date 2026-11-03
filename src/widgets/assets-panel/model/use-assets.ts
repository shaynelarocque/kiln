import { useState } from "react"
import { editorApi, useEditorStore } from "@/entities/editor"
import { allNodes, edit, findNode, useProjectStore, type Asset, type ImageFormat } from "@/entities/project"
import { bytesPerPixel, importImages, reconvert } from "@/features/import-image"

/** View-model for the assets panel: importing images, their formats, and where they're used. */
export function useAssets() {
  const project = useProjectStore(s => s.project)
  const selection = useEditorStore(s => s.selection)
  const [over, setOver] = useState(false)
  const selected = selection.length === 1 ? findNode(project, selection[0]) : undefined
  const nodes = allNodes(project)

  return {
    assets: project.assets,
    over,
    imageTarget: selected?.widget === "image" ? selected : undefined,
    flashBytes: (a: Asset) => a.width * a.height * bytesPerPixel[a.format],
    usesOf: (a: Asset) => nodes.filter(n => n.props.src === a.id || Object.values(n.style).some(p => p.bg_image_src === a.id)).length,
    pick: () => {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
      input.multiple = true
      input.onchange = () => input.files && importImages(input.files)
      input.click()
    },
    dragOver: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(true)
    },
    dragLeave: () => setOver(false),
    drop: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      importImages(e.dataTransfer.files)
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
