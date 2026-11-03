import { WIDGETS } from "@/shared/lvgl"
import { newId } from "./factory"
import type { Node, Project } from "./types"

/** Helpers for immer drafts of a Project. Every feature edits nodes through these. */

export type Found = { node: Node; parent: Node | null; index: number }

export function locate(project: Project, id: string): Found | null {
  const visit = (node: Node, parent: Node | null, index: number): Found | null => {
    if (node.id === id) return { node, parent, index }
    for (let i = 0; i < node.children.length; i++) {
      const hit = visit(node.children[i], node, i)
      if (hit) return hit
    }
    return null
  }
  for (let i = 0; i < project.screens.length; i++) {
    const hit = visit(project.screens[i], null, i)
    if (hit) return hit
  }
  return null
}

/** Instances show their main's children, so nothing can be added to them directly. */
export const canContain = (node: Node) => Boolean(WIDGETS[node.widget].container) && !node.component

/** Removes nodes (screens too, but never the last one) and anything pointing at them. */
export function removeNodes(project: Project, ids: string[]) {
  for (const id of ids) {
    const hit = locate(project, id)
    if (!hit) continue
    if (hit.parent) hit.parent.children.splice(hit.index, 1)
    else if (project.screens.length > 1) project.screens.splice(hit.index, 1)
  }
  const alive = new Set<string>()
  for (const s of project.screens) collect(s, alive)
  for (const anim of project.animations) anim.tracks = anim.tracks.filter(t => alive.has(t.node))
  for (const s of project.screens) visitAll(s, n => (n.events = n.events.filter(e => e.action.type !== "navigate" || alive.has(e.action.screen))))
}

function collect(node: Node, out: Set<string>) {
  out.add(node.id)
  node.children.forEach(c => collect(c, out))
}

function visitAll(node: Node, fn: (n: Node) => void) {
  fn(node)
  node.children.forEach(c => visitAll(c, fn))
}

export function insertNode(project: Project, parentId: string, node: Node, index?: number) {
  const parent = locate(project, parentId)?.node
  if (!parent) return
  parent.children.splice(index ?? parent.children.length, 0, node)
}

/** Moves a node under a new parent, refusing to move it into itself. */
export function moveNode(project: Project, id: string, parentId: string, index: number) {
  const hit = locate(project, id)
  const target = locate(project, parentId)?.node
  if (!hit?.parent || !target) return
  const inside = new Set<string>()
  collect(hit.node, inside)
  if (inside.has(parentId)) return
  hit.parent.children.splice(hit.index, 1)
  const at = hit.parent === target && index > hit.index ? index - 1 : index
  target.children.splice(Math.min(at, target.children.length), 0, hit.node)
}

/** A deep copy with fresh ids and names that don't clash. */
export function cloneNode(project: Project, node: Node): Node {
  const copy: Node = structuredClone(node)
  const taken = new Set<string>()
  for (const s of project.screens) visitAll(s, n => taken.add(n.name))
  visitAll(copy, n => {
    n.id = newId()
    n.events = n.events.map(e => ({ ...e, id: newId() }))
    n.name = uniqueIn(taken, n.name)
  })
  return copy
}

function uniqueIn(taken: Set<string>, base: string) {
  const stem = base.replace(/[ _]\d+$/, "")
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${stem}_${i}`
  taken.add(name)
  return name
}

/** A node name nobody in the project uses yet. */
export function uniqueName(project: Project, base: string) {
  const taken = new Set<string>()
  for (const s of project.screens) visitAll(s, n => taken.add(n.name))
  const stem = base.toLowerCase().replace(/\W+/g, "_")
  let name = stem
  for (let i = 2; taken.has(name); i++) name = `${stem}_${i}`
  return name
}
