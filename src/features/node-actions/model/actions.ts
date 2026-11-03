import { editorApi } from "@/entities/editor"
import { canContain, cloneNode, createNode, edit, findParent, insertNode, locate, moveNode, projectApi, removeNodes, uniqueName, type Node } from "@/entities/project"

const selection = () => editorApi.getState().selection
const project = () => projectApi.getState().project
/** ids of selected nodes that aren't screens */
const selectedNodes = () => selection().filter(id => locate(project(), id)?.parent)

let clipboard: Node[] = []

export function deleteSelection() {
  const ids = selection()
  if (!ids.length) return
  edit(d => removeNodes(d, ids))
  editorApi.getState().select([])
}

export function duplicateSelection() {
  const ids = selectedNodes()
  const copies: string[] = []
  edit(d => {
    for (const id of ids) {
      const hit = locate(d, id)
      if (!hit?.parent) continue
      const copy = cloneNode(d, hit.node)
      if (typeof copy.layout.x === "number" && !hit.parent.layout.flex) copy.layout.x += 10
      if (typeof copy.layout.y === "number" && !hit.parent.layout.flex) copy.layout.y += 10
      hit.parent.children.splice(hit.index + 1, 0, copy)
      copies.push(copy.id)
    }
  })
  if (copies.length) editorApi.getState().select(copies)
}

export function copySelection() {
  clipboard = selectedNodes().map(id => structuredClone(locate(project(), id)!.node))
}

export function cutSelection() {
  copySelection()
  deleteSelection()
}

/** Pastes into the selected container, beside the selected widget, or onto the first screen. */
export function paste() {
  if (!clipboard.length) return
  const hit = locate(project(), selection()[0] ?? "")
  const parent = hit ? (canContain(hit.node) && !clipboard.some(c => c.id === hit.node.id) ? hit.node : (hit.parent ?? hit.node)) : project().screens[0]
  const pasted: string[] = []
  edit(d => {
    for (const node of clipboard) {
      const copy = cloneNode(d, node)
      insertNode(d, parent.id, copy)
      pasted.push(copy.id)
    }
  })
  editorApi.getState().select(pasted)
}

export function nudge(dx: number, dy: number) {
  const ids = selectedNodes()
  if (!ids.length) return
  edit(d => {
    for (const id of ids) {
      const n = locate(d, id)?.node
      if (!n) continue
      if (typeof n.layout.x === "number") n.layout.x += dx
      if (typeof n.layout.y === "number") n.layout.y += dy
    }
  })
}

/** Moves a node one step up or down among its siblings (later draws on top). */
export function restack(id: string, by: 1 | -1) {
  const hit = locate(project(), id)
  if (!hit?.parent) return
  const index = hit.index + by
  if (index < 0 || index >= hit.parent.children.length) return
  edit(d => moveNode(d, id, hit.parent!.id, by > 0 ? index + 1 : index))
}

/** Wraps the selection in a transparent container, like Figma's frame selection. */
export function groupSelection() {
  const ids = selectedNodes()
  if (!ids.length) return
  const parent = findParent(project(), ids[0])
  if (!parent || ids.some(id => findParent(project(), id)?.id !== parent.id)) return
  const group = createNode("container", {
    name: uniqueName(project(), "group"),
    layout: { x: 0, y: 0, w: "content", h: "content", align: "LV_ALIGN_TOP_LEFT" },
    style: { "main:default": { bg_opa: 0, border_width: 0, pad_top: 0, pad_bottom: 0, pad_left: 0, pad_right: 0 } },
  })
  edit(d => {
    const p = locate(d, parent.id)!.node
    const index = Math.min(...ids.map(id => p.children.findIndex(c => c.id === id)))
    group.children = ids.map(id => p.children.find(c => c.id === id)!).filter(Boolean).map(c => structuredClone(c))
    p.children = p.children.filter(c => !ids.includes(c.id))
    p.children.splice(index, 0, group)
  })
  editorApi.getState().select([group.id])
}

export function updateNode(id: string, recipe: (node: Node) => void, phase?: "start" | "move" | "end") {
  edit(d => {
    const n = locate(d, id)?.node
    if (n) recipe(n)
  }, phase)
}

export function selectAllSiblings() {
  const first = selection()[0]
  const parent = first ? findParent(project(), first) : project().screens[0]
  const scope = parent ?? locate(project(), first)?.node
  if (scope) editorApi.getState().select(scope.children.map(c => c.id))
}
