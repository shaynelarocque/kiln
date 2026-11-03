import { useState } from "react"
import { editorApi, useEditorStore } from "@/entities/editor"
import { canContain, createScreen, edit, locate, moveNode, removeNodes, screenOf, useProjectStore, type Node } from "@/entities/project"
import { updateNode } from "@/features/node-actions"

export type Row = { node: Node; depth: number; container: boolean; collapsed: boolean; hiddenByParent: boolean }
export type Drop = { id: string; where: "before" | "after" | "inside" }

/** View-model for the layers panel: screens, the active screen's tree, and its edits. */
export function useLayers() {
  const project = useProjectStore(s => s.project)
  const selection = useEditorStore(s => s.selection)
  const hover = useEditorStore(s => s.hover)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [drop, setDrop] = useState<Drop | null>(null)
  const active = (selection[0] && screenOf(project, selection[0])) || project.screens[0]

  const rows: Row[] = []
  const add = (nodes: Node[], depth: number, hiddenByParent: boolean) => {
    // top of the list draws on top, like Figma: children are listed in reverse
    for (const node of [...nodes].reverse()) {
      const isCollapsed = collapsed.has(node.id)
      rows.push({ node, depth, container: canContain(node) && node.children.length > 0, collapsed: isCollapsed, hiddenByParent })
      if (!isCollapsed) add(node.children, depth + 1, hiddenByParent || Boolean(node.hidden))
    }
  }
  add(active.children, 0, false)

  const select = (id: string, additive: boolean) => {
    const { selection, select } = editorApi.getState()
    select(additive ? (selection.includes(id) ? selection.filter(x => x !== id) : [...selection, id]) : [id])
  }

  const addScreen = () => {
    const { width } = project.target.display
    const x = Math.max(...project.screens.map(s => s.frame.x)) + width + 80
    const screen = createScreen(`Screen ${project.screens.length + 1}`, project.target.display, { x, y: project.screens[0].frame.y })
    screen.style = structuredClone(project.screens[0].style)
    edit(d => void d.screens.push(screen))
    editorApi.getState().select([screen.id])
  }

  /** The first screen is the one the board shows at boot. */
  const makeStart = (id: string) =>
    edit(d => {
      const i = d.screens.findIndex(s => s.id === id)
      if (i > 0) d.screens.unshift(...d.screens.splice(i, 1))
    })

  const deleteScreen = (id: string) => {
    if (project.screens.length < 2) return
    edit(d => removeNodes(d, [id]))
    editorApi.getState().select([])
  }

  /** Before/after a row by its top or bottom quarter, inside a container by its middle. */
  const dropAt = (row: Row, e: React.DragEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const f = (e.clientY - box.top) / box.height
    const where: Drop["where"] = canContain(row.node) && f > 0.25 && f < 0.75 ? "inside" : f < 0.5 ? "before" : "after"
    setDrop({ id: row.node.id, where })
  }

  const finishDrop = (dragged: string) => {
    if (!drop || dragged === drop.id) return setDrop(null)
    const target = locate(project, drop.id)
    if (target?.parent) {
      // the list is reversed, so "before" in the list is after in the children array
      if (drop.where === "inside") edit(d => moveNode(d, dragged, drop.id, locate(d, drop.id)!.node.children.length))
      else edit(d => moveNode(d, dragged, target.parent!.id, drop.where === "before" ? target.index + 1 : target.index))
    }
    setDrop(null)
  }

  return {
    project,
    active,
    rows,
    selection,
    hover,
    drop,
    select,
    hoverRow: (id: string | null) => editorApi.getState().setHover(id),
    toggle: (id: string) =>
      setCollapsed(c => {
        const next = new Set(c)
        if (!next.delete(id)) next.add(id)
        return next
      }),
    rename: (id: string, name: string) => updateNode(id, n => void (n.name = name)),
    toggleHidden: (id: string) => updateNode(id, n => void (n.hidden = !n.hidden)),
    toggleLocked: (id: string) => updateNode(id, n => void (n.locked = !n.locked)),
    addScreen,
    deleteScreen,
    makeStart,
    startId: project.screens.find(sc => !sc.library)?.id,
    dropAt,
    finishDrop,
    clearDrop: () => setDrop(null),
  }
}
