import type { Project } from "../model/types"
import { ttfUses } from "./fonts"
import { walk } from "./tree"

export const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "item"

/** Names the generated code defines itself. */
const RESERVED = ["ui_init", "ui_setup", "ui_wire"]

/** Identifiers the exporter derives from a name (screen functions, string buffers, image data…). */
const DERIVED = ["", "_create", "_buf", "_prev", "_props", "_map", "_series", "_transition"]

/**
 * C identifiers for everything the generated code declares, unique across the project:
 * ui_<node>, ui_var_<variable>, ui_style_<style>, ui_anim_<animation>, ui_img_<asset>, UI_COLOR_<token>,
 * ui_ttf_<font file> and ui_font_<font>_<px> (a TinyTTF font at one size, keyed "<font id>@<px>").
 */
export function cNames(project: Project): Record<string, string> {
  const used = new Set<string>(RESERVED)
  // a name is free only if none of the identifiers derived from it are taken either
  const unique = (base: string) => {
    let name = base
    for (let i = 2; DERIVED.some(d => used.has(name + d)); i++) name = `${base}_${i}`
    for (const d of DERIVED) used.add(name + d)
    return name
  }
  const names: Record<string, string> = {}
  for (const screen of project.screens)
    walk(screen, node => {
      const n = unique(`ui_${slug(node.name)}`)
      names[node.id] = n
      // derived forms are reserved for their own node by unique()
      if (node.transition) names[`${node.id}.tr`] = `${n}_transition`
      if (node.widget === "chart") names[`${node.id}.series`] = `${n}_series`
    })
  for (const v of project.variables) names[v.id] = unique(`ui_var_${slug(v.name)}`)
  for (const s of project.styles) names[s.id] = unique(`ui_style_${slug(s.name)}`)
  for (const a of project.animations) names[a.id] = unique(`ui_anim_${slug(a.name)}`)
  for (const a of project.assets) names[a.id] = unique(`ui_img_${slug(a.name)}`)
  for (const f of project.fonts) names[f.id] = unique(`ui_ttf_${slug(f.name)}`)
  for (const { id, size } of ttfUses(project))
    names[`${id}@${size}`] = unique(`ui_font_${slug(project.fonts.find(f => f.id === id)!.name)}_${size}`)
  for (const t of project.tokens) names[t.id] = unique(`UI_COLOR_${slug(t.name).toUpperCase()}`)
  return names
}
