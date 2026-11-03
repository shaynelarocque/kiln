import { TTF_SIZES, nearestFontSize, parseTtfFont } from "@/shared/lvgl"
import type { Node, Project } from "../model/types"
import { allNodes, walk } from "./tree"

/** Every imported font size the styles use, once each: the TinyTTF fonts a build makes. */
export function ttfUses(project: Project) {
  const uses = new Map<string, { id: string; size: number }>()
  const add = (value: unknown) => {
    const f = parseTtfFont(value)
    if (
      f &&
      f.size >= TTF_SIZES.min &&
      f.size <= TTF_SIZES.max &&
      project.fonts.some(x => x.id === f.id)
    )
      uses.set(`${f.id}@${f.size}`, f)
  }
  for (const n of allNodes(project))
    for (const props of Object.values(n.style)) add(props.text_font)
  for (const s of project.styles) add(s.props.text_font)
  return [...uses.values()].sort((a, b) => a.id.localeCompare(b.id) || a.size - b.size)
}

/** LVGL's symbols (LV_SYMBOL_*) are FontAwesome glyphs that only the built-in fonts carry. */
const SYMBOL = /[\uF000-\uF8FF]/

const ownSymbols = (n: Node) =>
  Object.values(n.props).some(v => typeof v === "string" && SYMBOL.test(v)) ||
  n.bindings.some(b => b.kind === "text" && SYMBOL.test(b.format ?? ""))
const anySymbols = (n: Node): boolean => ownSymbols(n) || n.children.some(anySymbols)

/**
 * The built-in Montserrat each imported font size borrows LVGL's symbols from, keyed by its
 * ttf: value: only for sizes set on text with symbols in it (the node's or, since fonts
 * inherit, its children's), so other sizes don't pull a built-in font into flash.
 */
export function ttfFallbacks(project: Project) {
  const out = new Map<string, string>()
  const fontsOf = (n: Node) => [
    ...Object.values(n.style).map(s => s.text_font),
    ...n.classes.map(c => project.styles.find(s => s.id === c.style)?.props.text_font),
  ]
  for (const screen of project.screens)
    walk(screen, n => {
      for (const value of fontsOf(n)) {
        const ttf = parseTtfFont(value)
        if (ttf && !out.has(String(value)) && anySymbols(n))
          out.set(String(value), `lv_font_montserrat_${nearestFontSize(ttf.size)}`)
      }
    })
  return out
}
