import { useEffect, useRef, useState } from "react"
import { editorApi } from "@/entities/editor"
import { ProjectPlayer, screenOf, useProjectStore } from "@/entities/project"
import { getRuntime } from "@/shared/lvgl"

/**
 * Play mode: the whole UI running on one device-sized LVGL display, with real input,
 * events, animations and simulated variables. Values are read back ~10× a second for the sidebar.
 */
export function usePlayer() {
  const project = useProjectStore(s => s.project)
  const canvas = useRef<HTMLCanvasElement>(null)
  const player = useRef<ProjectPlayer | null>(null)
  const [values, setValues] = useState<Record<string, number>>({})
  const [screen, setScreen] = useState<string | undefined>()
  const [run, setRun] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let raf = 0
    const selected = editorApi.getState().selection[0]
    const start = (selected && screenOf(project, selected)?.id) || project.screens[0].id
    getRuntime().then(rt => {
      if (!alive || !canvas.current) return
      try {
        player.current = new ProjectPlayer(rt, project, start)
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e))
        return
      }
      const ctx = canvas.current.getContext("2d")!
      let last = performance.now()
      let lastRead = 0
      const loop = (now: number) => {
        const p = player.current
        if (!p) return
        p.frame(Math.min(100, now - last), ctx)
        last = now
        if (now - lastRead > 100) {
          lastRead = now
          setValues(Object.fromEntries(project.variables.filter(v => v.type === "int").map(v => [v.id, p.get(v.id)])))
          setScreen(p.activeScreen())
        }
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      player.current?.dispose()
      player.current = null
    }
    // the player runs a snapshot: edits made meanwhile show on the next Play
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  /** Pointer position in display pixels; the canvas is scaled up on screen. */
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return [((e.clientX - box.left) / box.width) * e.currentTarget.width, ((e.clientY - box.top) / box.height) * e.currentTarget.height] as const
  }

  return {
    project,
    canvas,
    values,
    failure,
    screenName: project.screens.find(s => s.id === screen)?.name,
    restart: () => setRun(r => r + 1),
    close: () => editorApi.getState().set({ playing: false }),
    setValue: (id: string, v: number) => player.current?.set(id, v),
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      player.current?.pointer(...point(e), true)
    },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => player.current?.pointer(...point(e), e.buttons > 0),
    onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => player.current?.pointer(...point(e), false),
  }
}
