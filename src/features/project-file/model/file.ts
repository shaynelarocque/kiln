import { editorApi } from "@/entities/editor"
import {
  createEmptyProject,
  createPetProject,
  createSampleProject,
  projectApi,
  type Project,
} from "@/entities/project"
import { confirmAction, inTauri, invoke } from "@/shared/lib/tauri"

const FILTERS = [{ name: "Kiln project", extensions: ["kiln"] }]
const AUTOSAVE = "kiln:autosave"

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

const isDirty = () => {
  const { doc, saved } = projectApi.getState()
  return doc !== saved
}

const confirmDiscard = async () => !isDirty() || confirmAction("Discard unsaved changes?")

/** What New can start from: a blank screen or one of the samples. */
export const TEMPLATES = [
  { value: "blank", label: "Blank project", create: () => createEmptyProject() },
  { value: "thermostat", label: "Sample: round thermostat", create: createSampleProject },
  { value: "pet", label: "Sample: breathalyzer pet", create: createPetProject },
]

export async function newProject(template = "blank") {
  const t = TEMPLATES.find(x => x.value === template)
  if (!t || !(await confirmDiscard())) return
  projectApi.getState().replace(t.create())
  editorApi.getState().select([])
}

export async function openProject() {
  if (!(await confirmDiscard())) return
  try {
    if (inTauri()) {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const path = await open({ filters: FILTERS, multiple: false, directory: false })
      if (typeof path !== "string") return
      projectApi.getState().replace(parseProject(await invoke<string>("read_text", { path })), path)
    } else {
      const file = await pickFile(".kiln,application/json")
      if (file) projectApi.getState().replace(parseProject(await file.text()))
    }
    editorApi.getState().select([])
  } catch (e) {
    editorApi.getState().set({ error: `Couldn't open: ${e instanceof Error ? e.message : e}` })
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

/**
 * Keeps the open project in localStorage so a crash or reload loses nothing, and restores it at
 * launch, still marked unsaved if it was. Closing with unsaved work asks first.
 */
export function startAutosave() {
  try {
    const saved = localStorage.getItem(AUTOSAVE)
    if (saved) {
      const { project, path, dirty } = JSON.parse(saved)
      projectApi.getState().replace(parseProject(JSON.stringify(project)), path, dirty !== false)
    }
  } catch {
    // a bad or missing autosave just means starting from the sample
  }
  let timer = 0
  const write = () => {
    clearTimeout(timer)
    const s = projectApi.getState()
    try {
      localStorage.setItem(
        AUTOSAVE,
        JSON.stringify({ project: s.doc, path: s.path, dirty: s.doc !== s.saved }),
      )
    } catch {
      // over quota (big images): the file on disk is still the source of truth
    }
  }
  const stop = projectApi.subscribe(() => {
    clearTimeout(timer)
    timer = window.setTimeout(write, 500)
  })
  // leaving writes the last half second of edits too
  const unload = (e: BeforeUnloadEvent) => (write(), isDirty() && e.preventDefault())
  window.addEventListener("beforeunload", unload)
  let unlisten: (() => void) | undefined
  if (inTauri())
    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      unlisten = await getCurrentWindow().onCloseRequested(async e => {
        write()
        if (
          isDirty() &&
          !(await confirmAction("Quit without saving? Your changes stay in Kiln's autosave."))
        )
          e.preventDefault()
      })
    })
  return () => {
    stop()
    window.removeEventListener("beforeunload", unload)
    unlisten?.()
  }
}
