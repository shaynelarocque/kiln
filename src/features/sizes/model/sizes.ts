import type { DisplayPreset } from "@/entities/board"
import { edit, locate, newId, projectApi, removeSize, type DisplayConfig } from "@/entities/project"

/** "240×240 round", "320×240": what a size is called until someone renames it. */
export const sizeLabel = (d: Pick<DisplayConfig, "width" | "height" | "round">) =>
  `${d.width}×${d.height}${d.round ? " round" : ""}`

/** Adds a size for a display module, on the base board, and switches to it. */
export function addSize(preset: DisplayPreset) {
  const { doc } = projectApi.getState()
  // another module has its own touch panel, if any: the base's calibration wouldn't fit it
  const { touch: _, ...base } = doc.target.display
  const display: DisplayConfig = {
    ...base,
    driver: preset.driver,
    width: preset.width,
    height: preset.height,
    round: Boolean(preset.round),
    invert: preset.invert,
    bgr: preset.bgr,
    offsetX: preset.offsetX ?? 0,
    offsetY: preset.offsetY ?? 0,
    rotation: 0,
  }
  const id = newId()
  edit(
    d =>
      void d.sizes.push({
        id,
        name: sizeLabel(display),
        target: { ...doc.target, display },
      }),
  )
  projectApi.getState().setSize(id)
}

/** Deletes a size and what every node changed there. */
export function deleteSize(id: string) {
  // from the base: through the size's own view, the lens would write the patches straight back
  projectApi.getState().setSize(null)
  edit(d => removeSize(d, id))
}

export const renameSize = (id: string, name: string) =>
  edit(d => {
    const size = d.sizes.find(s => s.id === id)
    if (size && name.trim()) size.name = name.trim().slice(0, 40)
  })

/** Gives a node its base layout, style and visibility back at the size being edited. */
export function resetAtSize(nodeId: string) {
  const { doc, size } = projectApi.getState()
  const base = size ? locate(doc, nodeId)?.node : undefined
  if (!base) return
  edit(d => {
    const n = locate(d, nodeId)?.node
    if (!n) return
    n.layout = structuredClone(base.layout)
    n.style = structuredClone(base.style)
    n.hidden = base.hidden
  })
}
