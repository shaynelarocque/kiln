import { deviceApi, deviceStore } from "@/entities/device"
import { editorApi } from "@/entities/editor"
import {
  createEmptyProject,
  createPetProject,
  createSampleProject,
  projectApi,
  type Project,
} from "@/entities/project"
import { confirmAction, inTauri, invoke, onMac } from "@/shared/lib/tauri"
import { withHardware } from "./hardware"
import { forget, remember } from "./recent"
import { activate, anyDirty, openTab, tabForPath, tabProject, workspaceApi } from "./workspace"

const FILTERS = [{ name: "Kiln project", extensions: ["kiln"] }]
const AUTOSAVE = "kiln:autosave"
const SESSION = "kiln:session"

/**
 * Reads a project file, checking it's one of ours before it replaces the open project. Fields that
 * end up in platformio.ini (which pio runs) are checked here too, not only at export.
 */
export function parseProject(text: string): Project {
  const data = JSON.parse(text)
  if (data?.kiln !== 1 || !Array.isArray(data.screens) || !data.screens.length)
    throw new Error("Not a Kiln project file")
  // files from before sizes; each size has a board of its own, which reaches platformio.ini too
  if (!Array.isArray(data.sizes)) data.sizes = []
  for (const target of [data.target, ...data.sizes.map((s: { target?: unknown }) => s?.target)])
    if (typeof target?.board !== "string" || !/^[\w.-]+$/.test(target.board))
      throw new Error("The file names an invalid board")
  data.name = String(data.name ?? "Untitled")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, 120)
  // files from before imported fonts
  if (!Array.isArray(data.fonts)) data.fonts = []
  // files from before sprites
  if (!Array.isArray(data.sprites)) data.sprites = []
  // before subjects became pointers (LVGL 9.6's lv_subject_create), custom code wrote &ui_var_x
  for (const v of data.variables ?? [])
    if (v.source?.kind === "custom")
      v.source.expr = String(v.source.expr).replace(/&\s*(ui_var_\w+)/g, "$1")
  return data as Project
}

/** What New can start from: a blank screen or one of the samples. */
export const TEMPLATES = [
  {
    value: "blank",
    label: "Blank project",
    note: "One empty screen on your board",
    create: () => createEmptyProject(),
  },
  {
    value: "thermostat",
    label: "Round thermostat",
    note: "A dial, a settings screen and a transition",
    create: createSampleProject,
  },
  {
    value: "pet",
    label: "Breathalyzer pet",
    note: "Sprites, moods and two screen sizes",
    create: createPetProject,
  },
]

/** A new tab holding a fresh project: never saved, so nothing to compare against yet. */
const fresh = (doc: Project, path: string | null = null, dirty = false) => ({
  doc,
  size: null,
  path,
  saved: dirty ? null : doc,
  past: [],
  future: [],
})

/** Starts a project from a template in a new tab, on the hardware set up last. */
export function newProject(template = "blank") {
  const t = TEMPLATES.find(x => x.value === template)
  if (t) openTab(fresh(withHardware(t.create(), t.value === "blank")))
}

const failed = (what: string, e: unknown) =>
  editorApi.getState().set({ error: `${what}: ${e instanceof Error ? e.message : e}` })

/** Opens a file from disk in its own tab, or switches to the tab that has it. */
export async function openPath(path: string) {
  const open = tabForPath(path)
  if (open) return activate(open.id)
  try {
    const project = parseProject(await invoke<string>("read_text", { path }))
    openTab(fresh(project, path))
    remember(path, project, null)
  } catch (e) {
    forget(path)
    failed("Couldn't open", e)
  }
}

export async function openProject() {
  try {
    if (inTauri()) {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const path = await open({ filters: FILTERS, multiple: false, directory: false })
      if (typeof path === "string") await openPath(path)
    } else {
      const file = await pickFile(".kiln,application/json")
      if (file) openTab(fresh(parseProject(await file.text())))
    }
  } catch (e) {
    failed("Couldn't open", e)
  }
}

export async function saveProject(saveAs = false) {
  // the document, with every size; not the view of the size being edited
  const { doc: project, path } = projectApi.getState()
  const text = JSON.stringify(project, null, 1)
  try {
    if (inTauri()) {
      let target = path
      if (!target || saveAs) {
        const { save } = await import("@tauri-apps/plugin-dialog")
        target = await save({ filters: FILTERS, defaultPath: `${project.name}.kiln` })
        if (!target) return
      }
      await invoke("write_text", { path: target, contents: text })
      projectApi.getState().markSaved(target)
      remember(target, project)
    } else {
      download(`${project.name}.kiln`, text)
      projectApi.getState().markSaved(`${project.name}.kiln`)
    }
  } catch (e) {
    editorApi.getState().set({ error: `Couldn't save: ${e instanceof Error ? e.message : e}` })
  }
}

function pickFile(accept: string) {
  return new Promise<File | undefined>(resolve => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0])
    input.click()
  })
}

export function download(name: string, contents: BlobPart, type = "application/json") {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type SavedTab = { project: Project; path: string | null; dirty: boolean }
type Session = { tabs: SavedTab[]; active: number; home: boolean }

/** The session from before tabs: one project. */
function oldAutosave(): Session | null {
  const saved = localStorage.getItem(AUTOSAVE)
  if (!saved) return null
  const { project, path, dirty } = JSON.parse(saved)
  return { tabs: [{ project, path, dirty: dirty !== false }], active: 0, home: false }
}

let restored = false

function restore() {
  if (restored) return
  restored = true
  try {
    const session: Session | null =
      JSON.parse(localStorage.getItem(SESSION) ?? "null") ?? oldAutosave()
    if (!session?.tabs?.length) return
    for (const t of session.tabs) {
      try {
        openTab(fresh(parseProject(JSON.stringify(t.project)), t.path, t.dirty))
      } catch {
        // one bad tab doesn't lose the others
      }
    }
    const { tabs } = workspaceApi.getState()
    const active = tabs[Math.min(Math.max(0, session.active), tabs.length - 1)]
    if (active) activate(active.id)
    workspaceApi.setState({ home: Boolean(session.home) })
  } catch {
    // a bad session just means starting from the home page
  }
}

/** Serialised tab projects, so an edit only re-serialises the tab it was made in. */
const serialised = new WeakMap<Project, string>()
const json = (p: Project) => {
  let text = serialised.get(p)
  if (text === undefined) serialised.set(p, (text = JSON.stringify(p)))
  return text
}

/**
 * Keeps every open tab in localStorage so a crash or reload loses nothing, and reopens them at
 * launch, still marked unsaved if they were. Closing with unsaved work asks first.
 */
export function startSession() {
  restore()
  let timer = 0
  const write = () => {
    clearTimeout(timer)
    const { tabs, active, home } = workspaceApi.getState()
    const parts = tabs.map(t => {
      const p = tabProject(t)
      return `{"project":${json(p.doc)},"path":${JSON.stringify(p.path)},"dirty":${p.doc !== p.saved}}`
    })
    try {
      localStorage.setItem(
        SESSION,
        `{"tabs":[${parts.join(",")}],"active":${Math.max(
          0,
          tabs.findIndex(t => t.id === active),
        )},"home":${home}}`,
      )
      localStorage.removeItem(AUTOSAVE)
    } catch {
      // over quota (big images): the files on disk are still the source of truth
    }
  }
  const later = () => {
    clearTimeout(timer)
    timer = window.setTimeout(write, 500)
  }
  const stopProject = projectApi.subscribe(later)
  const stopTabs = workspaceApi.subscribe(later)
  // leaving writes the last half second of edits too
  const unload = (e: BeforeUnloadEvent) => (write(), anyDirty() && e.preventDefault())
  window.addEventListener("beforeunload", unload)
  let unlisten: (() => void) | undefined
  let stopDirty: (() => void) | undefined
  if (inTauri()) {
    // the app asks before quitting with unsaved work, so it needs to know
    let told: boolean | null = null
    const tell = () => {
      const dirty = anyDirty()
      if (dirty !== told) deviceApi.setDirty((told = dirty)).catch(() => {})
    }
    tell()
    const a = projectApi.subscribe(tell)
    const b = workspaceApi.subscribe(tell)
    stopDirty = () => (a(), b())
    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      unlisten = await getCurrentWindow().onCloseRequested(async e => {
        write()
        // a Mac app outlives its window: a flash in progress keeps going, and the Dock icon
        // (or any menu item) brings the editor back
        if (onMac()) {
          e.preventDefault()
          await getCurrentWindow().hide()
          return
        }
        const busy = deviceStore.getState().job?.running
        const question = busy
          ? "A build is still running. Close Kiln and stop it?"
          : "Quit without saving? Your changes stay in Kiln's autosave."
        if ((busy || anyDirty()) && !(await confirmAction(question))) e.preventDefault()
      })
    })
  }
  return () => {
    stopProject()
    stopTabs()
    window.removeEventListener("beforeunload", unload)
    unlisten?.()
    stopDirty?.()
  }
}
