import { editorApi } from "@/entities/editor"
import { createEmptyProject, projectApi, type Project } from "@/entities/project"
import { inTauri, invoke } from "@/shared/lib/tauri"

const FILTERS = [{ name: "Kiln project", extensions: ["kiln"] }]
const AUTOSAVE = "kiln:autosave"

/** Reads a project file, checking it's one of ours before it replaces the open project. */
export function parseProject(text: string): Project {
  const data = JSON.parse(text)
  if (data?.kiln !== 1 || !Array.isArray(data.screens) || !data.screens.length) throw new Error("Not a Kiln project file")
  return data as Project
}

const confirmDiscard = () => {
  const { project, saved } = projectApi.getState()
  return project === saved || window.confirm("Discard unsaved changes?")
}

export function newProject() {
  if (!confirmDiscard()) return
  projectApi.getState().replace(createEmptyProject())
  editorApi.getState().select([])
}

export async function openProject() {
  if (!confirmDiscard()) return
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
  const { project, path } = projectApi.getState()
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

/** Keeps the open project in localStorage so a crash or reload loses nothing; restores it at launch. */
export function startAutosave() {
  try {
    const saved = localStorage.getItem(AUTOSAVE)
    if (saved) {
      const { project, path } = JSON.parse(saved)
      projectApi.getState().replace(parseProject(JSON.stringify(project)), path)
    }
  } catch {
    // a bad or missing autosave just means starting from the sample
  }
  let timer = 0
  return projectApi.subscribe(s => {
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE, JSON.stringify({ project: s.project, path: s.path }))
      } catch {
        // over quota (big images): the file on disk is still the source of truth
      }
    }, 500)
  })
}
