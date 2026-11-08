import { create } from "zustand"
import type { Project } from "@/entities/project"

/** A project file opened or saved lately, for the home page. */
export type Recent = {
  path: string
  name: string
  /** "GC9A01 240×240 round" */
  display: string
  at: number
  /** a small picture of its first screen, as a data: URL */
  thumb?: string
}

const KEY = "kiln:recent"
const MAX = 16

function load(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    return Array.isArray(list) ? list.filter(r => typeof r?.path === "string") : []
  } catch {
    return []
  }
}

export const useRecent = create<{ list: Recent[] }>()(() => ({ list: load() }))

function save(list: Recent[]) {
  useRecent.setState({ list })
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // over quota (thumbnails): drop the pictures and try once more
    try {
      localStorage.setItem(KEY, JSON.stringify(list.map(({ thumb: _, ...r }) => r)))
    } catch {
      // the list just lasts the session
    }
  }
}

/**
 * The first screen of the open project as the canvas draws it, small. Null when the canvas
 * isn't showing.
 */
export function captureThumb(): string | null {
  const source = document.querySelector<HTMLCanvasElement>("[data-artboard] canvas")
  if (!source?.width) return null
  const scale = 160 / Math.max(source.width, source.height)
  const out = document.createElement("canvas")
  out.width = Math.round(source.width * scale)
  out.height = Math.round(source.height * scale)
  const ctx = out.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, out.width, out.height)
  try {
    return out.toDataURL("image/png")
  } catch {
    return null
  }
}

export function remember(path: string, project: Project, thumb = captureThumb()) {
  const d = project.target.display
  const old = useRecent.getState().list.find(r => r.path === path)
  const entry: Recent = {
    path,
    name: project.name,
    display: `${d.driver.toUpperCase()} ${d.width}×${d.height}${d.round ? " round" : ""}`,
    at: Date.now(),
    thumb: thumb ?? old?.thumb,
  }
  save([entry, ...useRecent.getState().list.filter(r => r.path !== path)].slice(0, MAX))
}

export const forget = (path: string) => save(useRecent.getState().list.filter(r => r.path !== path))
