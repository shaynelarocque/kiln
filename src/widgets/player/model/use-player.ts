import { useEffect, useRef, useState } from "react"
import { editorApi } from "@/entities/editor"
import {
  ProjectPlayer,
  liveScreenOf,
  useProjectStore,
  type ButtonKey,
  type HardwareButton,
} from "@/entities/project"
import { BUTTON_KEYS, getRuntime, resetRuntime } from "@/shared/lvgl"
import { useRecorder } from "./use-recorder"

/** Keyboard keys that stand in for the board's buttons, by what the button sends. */
const KEYBOARD: Record<string, ButtonKey> = {
  Enter: "enter",
  Backspace: "esc",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
}
const keyFor = (e: KeyboardEvent): ButtonKey | undefined =>
  e.key === "Tab" ? (e.shiftKey ? "prev" : "next") : KEYBOARD[e.key]
const lvKey = (key: ButtonKey) => BUTTON_KEYS.find(k => k.value === key)!.key

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
  /** what the held buttons send, to light them up */
  const [held, setHeld] = useState<ButtonKey[]>([])
  const buttons = project.target.buttons ?? []
  const recorder = useRecorder(project, player)

  useEffect(() => {
    let alive = true
    let raf = 0
    const selected = editorApi.getState().selection[0]
    const previewed = project.animations.find(a => a.id === editorApi.getState().preview)
    const from = previewed?.tracks[0]?.node ?? selected
    const start = (from && liveScreenOf(project, from)?.id) || project.screens[0].id
    getRuntime().then(rt => {
      if (!alive || !canvas.current) return
      try {
        player.current = new ProjectPlayer(rt, project, start)
        const preview = editorApi.getState().preview
        if (preview) {
          player.current.play(preview)
          editorApi.getState().set({ preview: null })
        }
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
        try {
          p.frame(Math.min(100, now - last), ctx)
        } catch (e) {
          return crash(e)
        }
        last = now
        if (now - lastRead > 100) {
          lastRead = now
          setValues(
            Object.fromEntries(
              project.variables.filter(v => v.type === "int").map(v => [v.id, p.get(v.id)]),
            ),
          )
          setScreen(p.activeScreen())
        }
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      try {
        player.current?.dispose()
      } catch {
        // the runtime it lived on was already reset after a trap
      }
      player.current = null
    }
    // the player runs a snapshot: edits made meanwhile show on the next Play
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  /** A trap leaves LVGL unusable: say so, drop the player, and reset the shared runtime. */
  const crash = (e: unknown) => {
    setFailure(`LVGL stopped: ${e instanceof Error ? e.message : e}. Restart to try again.`)
    player.current = null
    resetRuntime()
  }
  const guarded = (fn: (p: ProjectPlayer) => void) => {
    const p = player.current
    if (!p) return
    try {
      fn(p)
    } catch (e) {
      crash(e)
    }
  }

  /** A board button going down or up, sent to LVGL as its key. */
  const press = (key: ButtonKey, down: boolean) => {
    setHeld(h => (down ? [...h, key] : h.filter(k => k !== key)))
    guarded(p => p.key(lvKey(key), down))
  }

  // the keyboard works the buttons the board has, and only those
  useEffect(() => {
    if (!buttons.length) return
    const down = new Map<string, ButtonKey>()
    const onDown = (e: KeyboardEvent) => {
      const key = keyFor(e)
      if (!key || !buttons.some(b => b.key === key)) return
      e.preventDefault()
      // LVGL repeats a held key itself
      if (e.repeat || down.has(e.code)) return
      down.set(e.code, key)
      press(key, true)
    }
    const onUp = (e: KeyboardEvent) => {
      const key = down.get(e.code)
      if (!key) return
      down.delete(e.code)
      press(key, false)
    }
    window.addEventListener("keydown", onDown)
    window.addEventListener("keyup", onUp)
    return () => {
      window.removeEventListener("keydown", onDown)
      window.removeEventListener("keyup", onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  /** Pointer position in display pixels; the canvas is scaled up on screen. */
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return [
      ((e.clientX - box.left) / box.width) * e.currentTarget.width,
      ((e.clientY - box.top) / box.height) * e.currentTarget.height,
    ] as const
  }

  return {
    project,
    canvas,
    values,
    failure,
    screenName: project.screens.find(s => s.id === screen)?.name,
    restart: () => {
      setFailure(null)
      setRun(r => r + 1)
    },
    close: () => editorApi.getState().set({ playing: false }),
    setValue: (id: string, v: number) => {
      guarded(p => p.set(id, v))
      recorder.set(id, v)
    },
    recorder,
    buttons,
    isHeld: (b: HardwareButton) => held.includes(b.key),
    buttonDown: (b: HardwareButton) => press(b.key, true),
    buttonUp: (b: HardwareButton) => held.includes(b.key) && press(b.key, false),
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      const at = point(e)
      guarded(p => p.pointer(...at, true))
      recorder.down(...at)
    },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => {
      const at = point(e)
      guarded(p => p.pointer(...at, e.buttons > 0))
    },
    onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => {
      const at = point(e)
      guarded(p => p.pointer(...at, false))
      recorder.up()
    },
  }
}
