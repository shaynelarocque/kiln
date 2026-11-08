import { create } from "zustand"
import { editorApi } from "@/entities/editor"
import { newId, projectApi, snapshot, type ProjectSnapshot } from "@/entities/project"
import { confirmAction } from "@/shared/lib/tauri"

/**
 * One open project, like a Figma tab. The active tab's project lives in the project store; the
 * others wait here as snapshots, undo history included, with the view they were left at.
 */
export type Tab = {
  id: string
  /** null while it's the active tab (the project store has it) */
  snapshot: ProjectSnapshot | null
  view: { zoom: number; pan: { x: number; y: number } } | null
}

type WorkspaceState = {
  tabs: Tab[]
  /** the tab whose project is in the project store */
  active: string | null
  /** the home page is showing (over the active tab, which stays loaded) */
  home: boolean
}

export const useWorkspace = create<WorkspaceState>()(() => ({ tabs: [], active: null, home: true }))
export const workspaceApi = useWorkspace

const isDirty = (s: Pick<ProjectSnapshot, "doc" | "saved">) => s.doc !== s.saved

/** A tab's project, live or waiting. */
export function tabProject(tab: Tab): ProjectSnapshot {
  return tab.snapshot ?? snapshot()
}

/** Whether any open tab has unsaved changes. */
export const anyDirty = () => useWorkspace.getState().tabs.some(t => isDirty(tabProject(t)))

/** Puts the active tab's project and view back into its tab. */
function stash() {
  const { active, tabs } = useWorkspace.getState()
  if (!active) return
  const { zoom, pan } = editorApi.getState()
  useWorkspace.setState({
    tabs: tabs.map(t =>
      t.id === active ? { ...t, snapshot: snapshot(), view: { zoom, pan } } : t,
    ),
  })
}

/** Makes a waiting tab the live one. */
function load(tab: Tab) {
  projectApi.getState().load(tab.snapshot!)
  editorApi.getState().set({
    selection: [],
    hover: null,
    animation: null,
    preview: null,
    playing: false,
    dialog: null,
    error: null,
    rects: new Map(),
    ...(tab.view ? { ...tab.view, fitPending: false } : { fitPending: true }),
  })
  useWorkspace.setState(s => ({
    tabs: s.tabs.map(t => (t.id === tab.id ? { ...t, snapshot: null } : t)),
    active: tab.id,
    home: false,
  }))
}

/** Opens a project in a new tab and switches to it. */
export function openTab(project: ProjectSnapshot) {
  stash()
  const tab: Tab = { id: newId(), snapshot: project, view: null }
  useWorkspace.setState(s => ({ tabs: [...s.tabs, tab] }))
  load(tab)
}

export function activate(id: string) {
  const { active, tabs } = useWorkspace.getState()
  if (id === active) return useWorkspace.setState({ home: false })
  const tab = tabs.find(t => t.id === id)
  if (!tab) return
  stash()
  load(useWorkspace.getState().tabs.find(t => t.id === id)!)
}

/** The tab with this file open, if any. */
export const tabForPath = (path: string) =>
  useWorkspace.getState().tabs.find(t => tabProject(t).path === path)

export const showHome = () => useWorkspace.setState({ home: true })

/** Closes a tab, asking first if it has unsaved changes. Resolves false if kept open. */
export async function closeTab(id: string) {
  const { tabs, active } = useWorkspace.getState()
  const at = tabs.findIndex(t => t.id === id)
  if (at < 0) return false
  const project = tabProject(tabs[at])
  if (
    isDirty(project) &&
    !(await confirmAction(`Close “${project.doc.name}” without saving? Its changes will be lost.`))
  )
    return false
  const rest = tabs.filter(t => t.id !== id)
  useWorkspace.setState({ tabs: rest })
  if (id !== active) return true
  const next = rest[Math.min(at, rest.length - 1)]
  if (next) load(next)
  else useWorkspace.setState({ active: null, home: true })
  return true
}

/** ⌘W: closes the open tab (not from the home page, where no tab is in view). */
export function closeActive() {
  const { active, home } = useWorkspace.getState()
  if (active && !home) return closeTab(active)
}
