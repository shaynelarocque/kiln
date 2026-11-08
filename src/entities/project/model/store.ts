import { produce, type Draft } from "immer"
import { create } from "zustand"
import { createSampleProject } from "./factory"
import { atSize, unsize } from "./sizes"
import type { Project } from "./types"

const HISTORY = 200

/** Everything a project tab keeps while another tab is open: the document and its history. */
export type ProjectSnapshot = {
  doc: Project
  size: string | null
  path: string | null
  saved: Project | null
  past: Project[]
  future: Project[]
}

type ProjectState = {
  /** the document: base values plus every size's patches; what's saved and undone */
  doc: Project
  /** the size being edited (see Project.sizes); null is the base size */
  size: string | null
  /** the document as the active size sees it: what the editor shows and edits */
  project: Project
  /** file on disk, if saved */
  path: string | null
  /** the document as last saved; dirty when it isn't `doc` (null: never saved since a restore) */
  saved: Project | null
  past: Project[]
  future: Project[]

  /** One undoable change. */
  commit: (recipe: (draft: Draft<Project>) => void) => void
  /** Start of a gesture: remember the current state as one undo step. */
  checkpoint: () => void
  /** A change during a gesture, folded into the last checkpoint. */
  preview: (recipe: (draft: Draft<Project>) => void) => void
  /** End of a gesture: drop the checkpoint if nothing actually changed. */
  settle: () => void
  undo: () => void
  redo: () => void
  replace: (project: Project, path?: string | null, dirty?: boolean) => void
  markSaved: (path: string) => void
  /** Edits another size from now on; null for the base. */
  setSize: (size: string | null) => void
  /** Swaps in another tab's project, history and all. */
  load: (snapshot: ProjectSnapshot) => void
}

/** The view for a document at a size, falling back to the base if that size is gone. */
const view = (doc: Project, size: string | null) => {
  const active = size && doc.sizes.some(s => s.id === size) ? size : null
  return { doc, size: active, project: atSize(doc, active) }
}

/**
 * Edits apply to the view; at a size, unsize() folds them back into the document. At the base
 * size the view is the document itself, so nothing changes there.
 */
const apply = (s: ProjectState, recipe: (draft: Draft<Project>) => void) => {
  const next = produce(s.project, recipe)
  if (next === s.project) return null
  return view(s.size ? unsize(s.doc, s.project, next, s.size) : next, s.size)
}

export const useProjectStore = create<ProjectState>()(set => {
  const initial = createSampleProject()
  return {
    doc: initial,
    size: null,
    project: initial,
    path: null,
    saved: initial,
    past: [],
    future: [],

    commit: recipe =>
      set(s => {
        const next = apply(s, recipe)
        return next ? { ...next, past: [...s.past, s.doc].slice(-HISTORY), future: [] } : s
      }),
    checkpoint: () => set(s => ({ past: [...s.past, s.doc].slice(-HISTORY), future: [] })),
    preview: recipe => set(s => apply(s, recipe) ?? s),
    settle: () => set(s => (s.past.at(-1) === s.doc ? { past: s.past.slice(0, -1) } : s)),
    undo: () =>
      set(s =>
        s.past.length
          ? {
              ...view(s.past.at(-1)!, s.size),
              past: s.past.slice(0, -1),
              future: [s.doc, ...s.future],
            }
          : s,
      ),
    redo: () =>
      set(s =>
        s.future.length
          ? { ...view(s.future[0], s.size), future: s.future.slice(1), past: [...s.past, s.doc] }
          : s,
      ),
    replace: (project, path = null, dirty = false) =>
      set({ ...view(project, null), path, saved: dirty ? null : project, past: [], future: [] }),
    markSaved: path => set(s => ({ path, saved: s.doc })),
    setSize: size => set(s => view(s.doc, size)),
    load: ({ doc, size, path, saved, past, future }) =>
      set({ ...view(doc, size), path, saved, past, future }),
  }
})

/** For code outside React (keyboard shortcuts, the canvas loop). */
export const projectApi = useProjectStore

/** The open project as a tab keeps it. */
export function snapshot(): ProjectSnapshot {
  const { doc, size, path, saved, past, future } = useProjectStore.getState()
  return { doc, size, path, saved, past, future }
}

/** Where a change sits in a drag: start checkpoints, move previews, end settles. None commits. */
export type Phase = "start" | "move" | "end"

/** The one way views change the project, gesture-aware so a drag is a single undo step. */
export function edit(recipe: (draft: Draft<Project>) => void, phase?: Phase) {
  const s = useProjectStore.getState()
  if (!phase) return s.commit(recipe)
  if (phase === "start") s.checkpoint()
  useProjectStore.getState().preview(recipe)
  if (phase === "end") useProjectStore.getState().settle()
}
