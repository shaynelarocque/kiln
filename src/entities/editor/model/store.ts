import { create } from "zustand"
import { MAIN_DEFAULT, type Rect } from "@/shared/lvgl"

export type LeftTab = "layers" | "data" | "styles" | "assets"
export type RightTab = "design" | "bind" | "interact"
export type Dialog = null | "board" | "export" | "shortcuts"

/** Session state: what's selected and how the editor is arranged. Not saved, not undoable. */
type EditorState = {
  /** selected node ids; a screen id selects the screen */
  selection: string[]
  hover: string | null
  zoom: number
  pan: { x: number; y: number }
  playing: boolean
  leftTab: LeftTab
  rightTab: RightTab
  /** the part:state the style inspector edits, like CSS :pressed */
  selector: string
  timelineOpen: boolean
  animation: string | null
  /** an animation to start as soon as Play opens */
  preview: string | null
  dialog: Dialog
  error: string | null
  /** where LVGL laid out each node, in display pixels: screen id → node id → box */
  rects: Map<string, Map<string, Rect>>

  select: (ids: string[]) => void
  setHover: (id: string | null) => void
  setView: (zoom: number, pan: { x: number; y: number }) => void
  set: (patch: Partial<Omit<EditorState, "select" | "setHover" | "setView" | "set">>) => void
}

export const useEditorStore = create<EditorState>()(set => ({
  selection: [],
  hover: null,
  zoom: 1.5,
  pan: { x: 120, y: 120 },
  playing: false,
  leftTab: "layers",
  rightTab: "design",
  selector: MAIN_DEFAULT,
  timelineOpen: false,
  animation: null,
  preview: null,
  dialog: null,
  error: null,
  rects: new Map(),

  select: ids => set(s => (sameIds(s.selection, ids) ? s : { selection: ids, selector: MAIN_DEFAULT })),
  setHover: hover => set({ hover }),
  setView: (zoom, pan) => set({ zoom, pan }),
  set: patch => set(patch),
}))

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/** Every laid-out box by node id, across screens (node ids are unique project-wide). */
export const nodeBoxes = (rects: EditorState["rects"]) => new Map([...rects.values()].flatMap(m => [...m]))

export const editorApi = useEditorStore
