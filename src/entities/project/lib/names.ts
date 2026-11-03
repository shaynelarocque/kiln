import type { Project } from "../model/types"
import { walk } from "./tree"

export const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "item"

/**
 * C identifiers for everything the generated code declares, unique across the project:
 * ui_<node>, ui_var_<variable>, ui_style_<style>, ui_anim_<animation>, ui_img_<asset>, UI_COLOR_<token>.
 */
export function cNames(project: Project): Record<string, string> {
  const used = new Set<string>()
  const unique = (base: string) => {
    let name = base
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`
    used.add(name)
    return name
  }
  const names: Record<string, string> = {}
  for (const screen of project.screens)
    walk(screen, node => {
      const n = unique(`ui_${slug(node.name)}`)
      names[node.id] = n
      if (node.transition) names[`${node.id}.tr`] = unique(`${n}_transition`)
      if (node.widget === "chart") names[`${node.id}.series`] = unique(`${n}_series`)
    })
  for (const v of project.variables) names[v.id] = unique(`ui_var_${slug(v.name)}`)
  for (const s of project.styles) names[s.id] = unique(`ui_style_${slug(s.name)}`)
  for (const a of project.animations) names[a.id] = unique(`ui_anim_${slug(a.name)}`)
  for (const a of project.assets) names[a.id] = unique(`ui_img_${slug(a.name)}`)
  for (const t of project.tokens) names[t.id] = unique(`UI_COLOR_${slug(t.name).toUpperCase()}`)
  return names
}
