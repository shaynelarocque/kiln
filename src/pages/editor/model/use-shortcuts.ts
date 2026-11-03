import { useEffect } from "react"
import { editorApi } from "@/entities/editor"
import { findParent, projectApi } from "@/entities/project"
import { redo, undo } from "@/features/history"
import {
  alignSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  nudge,
  paste,
  restack,
  selectAllSiblings,
  type AlignEdge,
} from "@/features/node-actions"
import { openProject, saveProject } from "@/features/project-file"

/** Figma's align keys, by physical key: ⌥ turns e.key into symbols on a Mac */
const ALIGN_KEYS: Record<string, AlignEdge> = { KeyA: "left", KeyD: "right", KeyH: "hcenter", KeyW: "top", KeyS: "bottom", KeyV: "vcenter" }

const typing = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable)

/** Editor-wide keys. Text fields keep their own keys, except save and open. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const run = (fn: () => unknown) => (e.preventDefault(), fn())
      if (mod && key === "s") return run(() => saveProject(e.shiftKey))
      if (mod && key === "o") return run(openProject)
      const editor = editorApi.getState()
      if (typing(e.target) || editor.dialog) return
      if (editor.playing) return key === "escape" && run(() => editor.set({ playing: false }))
      // synthetic events (automation, some remote desktops) can leave code empty
      const code = e.code || `Key${key.toUpperCase()}`
      if (e.altKey && e.ctrlKey && (code === "KeyH" || code === "KeyV")) return run(() => distributeSelection(code === "KeyH" ? "x" : "y"))
      if (e.altKey && !mod && ALIGN_KEYS[code]) return run(() => alignSelection(ALIGN_KEYS[code]))
      if (mod && key === "z") return run(e.shiftKey ? redo : undo)
      if (mod && key === "y") return run(redo)
      if (mod && key === "d") return run(duplicateSelection)
      if (mod && key === "c") return run(copySelection)
      if (mod && key === "x") return run(cutSelection)
      if (mod && key === "v") return run(paste)
      if (mod && key === "g") return run(groupSelection)
      if (mod && key === "a") return run(selectAllSiblings)
      if (mod && key === "enter") return run(() => editor.set({ playing: true }))
      if (key === "delete" || key === "backspace") return run(deleteSelection)
      const step = e.shiftKey ? 10 : 1
      if (key === "arrowleft") return run(() => nudge(-step, 0))
      if (key === "arrowright") return run(() => nudge(step, 0))
      if (key === "arrowup") return run(() => nudge(0, -step))
      if (key === "arrowdown") return run(() => nudge(0, step))
      if (key === "]" && editor.selection[0]) return run(() => restack(editor.selection[0], 1))
      if (key === "[" && editor.selection[0]) return run(() => restack(editor.selection[0], -1))
      if (e.key === "?") return run(() => editor.set({ dialog: "shortcuts" }))
      if (key === "escape") {
        const parent = editor.selection[0] && findParent(projectApi.getState().project, editor.selection[0])
        return run(() => editor.select(parent ? [parent.id] : []))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
