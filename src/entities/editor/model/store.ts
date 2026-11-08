import { create } from "zustand"
import { MAIN_DEFAULT, type Rect } from "@/shared/lvgl"

export type LeftTab = "layers" | "data" | "styles" | "assets"
export type RightTab = "design" | "bind" | "interact"
export type Dialog = null | "board" | "export" | "shortcuts" | "settings"
export type OutputTab = "build" | "monitor"

/** Panel sizes in px: the layers panel, the inspector, the timeline and the build output. */
export type Panels = { left: number; right: number; timeline: number; output: number }
export const PANEL_DEFAULTS: Panels = { left: 248, right: 280, timeline: 236, output: 220 }
const PANELS_KEY = "kiln.panels"

/** This viewer's panel sizes from last time, if the browser kept them. */
function savedPanels(): Panels {
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) ?? "{}")
    const valid = (k: keyof Panels) =>
      Number.isFinite(saved[k]) && saved[k] > 0 ? saved[k] : PANEL_DEFAULTS[k]
    return {
      left: valid("left"),
      right: valid("right"),
      timeline: valid("timeline"),
      output: valid("output"),
    }
  } catch {
    return PANEL_DEFAULTS
  }
}

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
  /** the build output and serial monitor, docked under the canvas */
  outputOpen: boolean
  outputTab: OutputTab
  panels: Panels
  animation: string | null
  /** an animation to start as soon as Play opens */
  preview: string | null
  dialog: Dialog
  error: string | null
  /** the canvas should fit the screens as soon as it has a size (a project just opened) */
  fitPending: boolean
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
  outputOpen: false,
  outputTab: "build",
  panels: savedPanels(),
  animation: null,
  preview: null,
  dialog: null,
  error: null,
  fitPending: true,
  rects: new Map(),

  select: ids =>
    set(s => (sameIds(s.selection, ids) ? s : { selection: ids, selector: MAIN_DEFAULT })),
  setHover: hover => set({ hover }),
  setView: (zoom, pan) => set({ zoom, pan }),
  set: patch => set(patch),
}))

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i])

/** Every laid-out box by node id, across screens (node ids are unique project-wide). */
export const nodeBoxes = (rects: EditorState["rects"]) =>
  new Map([...rects.values()].flatMap(m => [...m]))

export const editorApi = useEditorStore

useEditorStore.subscribe((s, prev) => {
  if (s.panels === prev.panels) return
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify(s.panels))
  } catch {
    // private windows and blocked storage: the sizes just don't outlive the session
  }
})
