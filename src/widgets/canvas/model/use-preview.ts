import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { editorApi } from "@/entities/editor"
import { ProjectPreview, useProjectStore, type Project } from "@/entities/project"
import { getRuntime, onRuntimeReset, resetRuntime } from "@/shared/lvgl"
import type { Rects } from "./interactions"

/**
 * Keeps an LVGL preview in step with the project: syncs on every change, reads back where
 * LVGL laid each node out, and paints at display rate. A trap reloads the runtime, and the
 * project that caused it isn't retried until it changes.
 */
export function usePreview() {
  const project = useProjectStore(s => s.project)
  const [preview, setPreview] = useState<ProjectPreview | null>(null)
  const [rects, setRects] = useState<Map<string, Rects>>(new Map())
  const failed = useRef<Project | null>(null)

  useEffect(() => {
    let alive = true
    let made: ProjectPreview | null = null
    const start = () =>
      getRuntime().then(rt => {
        if (alive) setPreview((made = new ProjectPreview(rt)))
      })
    start()
    // whoever trapped LVGL (the canvas, Play) reset it; rebuild on the fresh one
    const stop = onRuntimeReset(() => {
      made = null
      start()
    })
    return () => {
      alive = false
      stop()
      made?.dispose()
    }
  }, [])

  useLayoutEffect(() => {
    if (!preview || project === failed.current) return
    try {
      preview.sync(project)
      setRects(new Map(project.screens.map(s => [s.id, preview.rects(s.id)])))
      editorApi.getState().set({ error: null })
    } catch (e) {
      failed.current = project
      editorApi.getState().set({ error: e instanceof Error ? e.message : String(e) })
      resetRuntime()
    }
  }, [preview, project])

  useEffect(() => {
    if (!preview) return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      try {
        preview.frame(Math.min(100, now - last))
      } catch (e) {
        editorApi.getState().set({ error: `LVGL stopped: ${e instanceof Error ? e.message : e}` })
        return resetRuntime()
      }
      last = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [preview])

  return { preview, rects }
}
