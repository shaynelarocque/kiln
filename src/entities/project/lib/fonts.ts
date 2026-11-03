import { TTF_SIZES, parseTtfFont } from "@/shared/lvgl"
import type { Project } from "../model/types"
import { allNodes } from "./tree"

/** Every imported font size the styles use, once each: the TinyTTF fonts a build makes. */
export function ttfUses(project: Project) {
  const uses = new Map<string, { id: string; size: number }>()
  const add = (value: unknown) => {
    const f = parseTtfFont(value)
    if (f && f.size >= TTF_SIZES.min && f.size <= TTF_SIZES.max && project.fonts.some(x => x.id === f.id)) uses.set(`${f.id}@${f.size}`, f)
  }
  for (const n of allNodes(project)) for (const props of Object.values(n.style)) add(props.text_font)
  for (const s of project.styles) add(s.props.text_font)
  return [...uses.values()].sort((a, b) => a.id.localeCompare(b.id) || a.size - b.size)
}
