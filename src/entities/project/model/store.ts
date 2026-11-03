import { produce, type Draft } from "immer"
import { create } from "zustand"
import { createSampleProject } from "./factory"
import type { Project } from "./types"

const HISTORY = 200

type ProjectState = {
  project: Project
  /** file on disk, if saved */
  path: string | null
  /** the project as last saved; dirty when it isn't `project` */
  saved: Project
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
  replace: (project: Project, path?: string | null) => void
  markSaved: (path: string) => void
}

export const useProjectStore = create<ProjectState>()(set => {
  const initial = createSampleProject()
  return {
    project: initial,
    path: null,
    saved: initial,
    past: [],
    future: [],

    commit: recipe =>
      set(s => {
        const next = produce(s.project, recipe)
        return next === s.project ? s : { project: next, past: [...s.past, s.project].slice(-HISTORY), future: [] }
      }),
    checkpoint: () => set(s => ({ past: [...s.past, s.project].slice(-HISTORY), future: [] })),
    preview: recipe => set(s => ({ project: produce(s.project, recipe) })),
    settle: () => set(s => (s.past.at(-1) === s.project ? { past: s.past.slice(0, -1) } : s)),
    undo: () =>
      set(s =>
        s.past.length ? { project: s.past.at(-1)!, past: s.past.slice(0, -1), future: [s.project, ...s.future] } : s,
      ),
    redo: () =>
      set(s => (s.future.length ? { project: s.future[0], future: s.future.slice(1), past: [...s.past, s.project] } : s)),
    replace: (project, path = null) => set({ project, path, saved: project, past: [], future: [] }),
    markSaved: path => set(s => ({ path, saved: s.project })),
  }
})

/** For code outside React (keyboard shortcuts, the canvas loop). */
export const projectApi = useProjectStore

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
