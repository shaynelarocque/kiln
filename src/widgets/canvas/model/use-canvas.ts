import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { editorApi, useEditorStore } from "@/entities/editor"
import {
  edit,
  findNode,
  findParent,
  locate,
  moveNode,
  projectApi,
  screenOf,
  useProjectStore,
  walk,
  type Phase,
  type Screen,
} from "@/entities/project"
import { navigateOnClick } from "@/features/node-actions"
import { useSettings } from "@/shared/config"
import type { Rect } from "@/shared/lvgl"
import {
  flexDrop,
  hitChain,
  isNumber,
  marqueeHits,
  pickDeeper,
  pickTarget,
  resizeLayout,
  snapMove,
  type Guide,
  type Handle,
} from "./interactions"
import { usePreview } from "./use-preview"

export type DragState = { screen: string; guides: Guide[]; drop: Rect | null; marquee?: Rect }

type Point = { x: number; y: number }
/** A navigation drawn as Figma's prototype noodle, in canvas coordinates. */
export type Flow = { id: string; from: Point; to: Point; selected: boolean }

const MIN_ZOOM = 0.1
const MAX_ZOOM = 16

/** Follows a pointer until release, reporting the offset in canvas pixels and the gesture phase. */
function drag(
  e: React.PointerEvent,
  onMove: (dx: number, dy: number, phase: Phase, ev: PointerEvent) => void,
  onClick?: () => void,
) {
  const zoom = editorApi.getState().zoom
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const [x0, y0] = [e.clientX, e.clientY]
  let moved = false
  const move = (ev: PointerEvent) => {
    const [dx, dy] = [(ev.clientX - x0) / zoom, (ev.clientY - y0) / zoom]
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return
    onMove(dx, dy, moved ? "move" : "start", ev)
    moved = true
  }
  const up = (ev: PointerEvent) => {
    el.removeEventListener("pointermove", move)
    el.removeEventListener("pointerup", up)
    el.removeEventListener("pointercancel", up)
    if (moved) onMove((ev.clientX - x0) / zoom, (ev.clientY - y0) / zoom, "end", ev)
    else onClick?.()
  }
  el.addEventListener("pointermove", move)
  el.addEventListener("pointerup", up)
  el.addEventListener("pointercancel", up)
}

export function useCanvas() {
  const preview = usePreview()
  const project = useProjectStore(s => s.project)
  const { zoom, pan, selection, hover, rects, rightTab } = useEditorStore()
  const viewport = useRef<HTMLDivElement>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [editing, setEditing] = useState<{ screen: string; id: string } | null>(null)
  const [noodle, setNoodle] = useState<{ from: Point; to: Point; target: string | null } | null>(
    null,
  )
  // the Interact tab is where interactions are edited, so that's when the canvas shows them
  const showFlows = rightTab === "interact"

  /** Each navigation from a widget to the screen it opens, entering it from the side it faces. */
  const flows = useMemo(() => {
    if (!showFlows) return []
    const { width, height } = project.target.display
    const out: Flow[] = []
    for (const screen of project.screens)
      walk(screen, n => {
        const r = rects.get(screen.id)?.get(n.id)
        for (const ev of n.events) {
          const { action } = ev
          const target =
            action.type === "navigate" && project.screens.find(s => s.id === action.screen)
          if (!target || !r) continue
          const from = { x: screen.frame.x + r.x + r.w, y: screen.frame.y + r.y + r.h / 2 }
          const x = target.frame.x >= from.x ? target.frame.x : target.frame.x + width
          out.push({
            id: ev.id,
            from,
            to: { x, y: target.frame.y + height / 2 },
            selected: selection.includes(n.id),
          })
        }
      })
    return out
  }, [showFlows, project, rects, selection])

  const setView = editorApi.getState().setView

  const zoomAt = useCallback(
    (next: number, cx: number, cy: number) => {
      const { zoom, pan } = editorApi.getState()
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
      setView(z, { x: cx - ((cx - pan.x) * z) / zoom, y: cy - ((cy - pan.y) * z) / zoom })
    },
    [setView],
  )

  const zoomCenter = useCallback(
    (next: number) => {
      const el = viewport.current
      if (el) zoomAt(next, el.clientWidth / 2, el.clientHeight / 2)
    },
    [zoomAt],
  )

  /** Zooms and pans so a box in canvas space fills the viewport, less a margin. */
  const fitBox = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      const el = viewport.current
      if (!el) return
      const z = Math.min(
        MAX_ZOOM,
        Math.max(
          MIN_ZOOM,
          Math.min(
            (el.clientWidth - 120) / Math.max(1, x2 - x1),
            (el.clientHeight - 120) / Math.max(1, y2 - y1),
          ),
        ),
      )
      setView(z, {
        x: (el.clientWidth - (x2 - x1) * z) / 2 - x1 * z,
        y: (el.clientHeight - (y2 - y1) * z) / 2 - y1 * z,
      })
    },
    [setView],
  )

  const fit = useCallback(() => {
    const { screens, target } = projectApi.getState().project
    if (!screens.length) return
    const { width: w, height: h } = target.display
    // 24 px of headroom for the screen names
    fitBox(
      Math.min(...screens.map(s => s.frame.x)),
      Math.min(...screens.map(s => s.frame.y)) - 24,
      Math.max(...screens.map(s => s.frame.x + w)),
      Math.max(...screens.map(s => s.frame.y + h)),
    )
  }, [fitBox])

  /** Fits the selected layers and screens; with nothing selected, everything. */
  const fitSelection = useCallback(() => {
    const { project } = projectApi.getState()
    const { selection, rects } = editorApi.getState()
    const { width, height } = project.target.display
    const boxes = selection.flatMap(id => {
      const screen = project.screens.find(s => s.id === id) ?? screenOf(project, id)
      const r =
        screen?.id === id
          ? { x: 0, y: 0, w: width, h: height }
          : screen && rects.get(screen.id)?.get(id)
      return screen && r
        ? [{ x: screen.frame.x + r.x, y: screen.frame.y + r.y, w: r.w, h: r.h }]
        : []
    })
    if (!boxes.length) return fit()
    fitBox(
      Math.min(...boxes.map(b => b.x)),
      Math.min(...boxes.map(b => b.y)),
      Math.max(...boxes.map(b => b.x + b.w)),
      Math.max(...boxes.map(b => b.y + b.h)),
    )
  }, [fit, fitBox])

  // Wheel must be non-passive to stop the page scrolling: trackpad scroll pans, pinch/ctrl zooms.
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const { zoom, pan } = editorApi.getState()
      if (e.ctrlKey || e.metaKey) {
        const box = el.getBoundingClientRect()
        zoomAt(zoom * Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top)
      } else setView(zoom, { x: pan.x - e.deltaX, y: pan.y - e.deltaY })
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
  }, [zoomAt, setView])

  useEffect(() => {
    const typing = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    const down = (e: KeyboardEvent) => {
      const { dialog, playing, zoom } = editorApi.getState()
      if (typing(e) || dialog || playing) return
      const run = (fn: () => void) => (e.preventDefault(), fn())
      if (e.code === "Space") return run(() => setSpaceDown(true))
      // Figma's view keys; ⌘ too, so the webview's own page zoom never kicks in
      if (e.key === "=" || e.key === "+") return run(() => zoomCenter(zoom * 1.25))
      if (e.key === "-" || e.key === "_") return run(() => zoomCenter(zoom / 1.25))
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === "Quote")
        return run(() =>
          useSettings.getState().update({ pixelGrid: !useSettings.getState().pixelGrid }),
        )
      if (e.code === "Digit1") return run(fit)
      if (e.code === "Digit2") return run(fitSelection)
      if (e.code === "Digit0") return run(() => zoomCenter(1))
    }
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [fit, fitSelection, zoomCenter])

  // fit the screens to the window the first time it has a real size
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (el.clientWidth > 200 && el.clientHeight > 200) {
        fit()
        observer.disconnect()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fit])

  const panBy = (e: React.PointerEvent) => {
    const start = editorApi.getState().pan
    const zoom = editorApi.getState().zoom
    drag(e, (dx, dy) => setView(zoom, { x: start.x + dx * zoom, y: start.y + dy * zoom }))
  }

  const onViewportPointerDown = (e: React.PointerEvent) => {
    if (spaceDown || e.button === 1) return panBy(e)
    if (e.target === e.currentTarget) editorApi.getState().select([])
  }

  /** Display-pixel position of a pointer event on an artboard. */
  const local = (e: React.PointerEvent | React.MouseEvent, el: HTMLElement) => {
    const box = el.getBoundingClientRect()
    const z = editorApi.getState().zoom
    return [(e.clientX - box.left) / z, (e.clientY - box.top) / z] as const
  }

  /** The artboard an event happened on, whichever of its parts caught it. */
  const artboardOf = (e: React.PointerEvent) =>
    (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-artboard]") ??
    (e.currentTarget as HTMLElement)

  const chainAt = (screen: Screen, e: React.PointerEvent | React.MouseEvent) => {
    const [x, y] = local(e, e.currentTarget as HTMLElement)
    return hitChain(screen, rects.get(screen.id) ?? new Map(), x, y)
  }

  const onArtboardPointerDown = (screen: Screen, e: React.PointerEvent) => {
    if (spaceDown || e.button === 1) return panBy(e)
    if (e.button !== 0) return
    e.stopPropagation()
    const { selection, select } = editorApi.getState()
    const target = pickTarget(chainAt(screen, e), selection, e.metaKey || e.ctrlKey)
    if (target.widget === "screen") return startMarquee(screen, e)
    if (e.shiftKey) {
      select(
        selection.includes(target.id)
          ? selection.filter(id => id !== target.id)
          : [...selection.filter(id => id !== screen.id), target.id],
      )
      return
    }
    const ids = selection.includes(target.id) ? selection : [target.id]
    select(ids)
    // like Figma, a click that doesn't drag narrows a selection to the layer clicked
    startMove(screen, ids, e, () => select([target.id]))
  }

  /** Dragging on a screen's background selects the layers the box touches (⇧ adds); a click selects the screen. */
  const startMarquee = (screen: Screen, e: React.PointerEvent) => {
    const [x0, y0] = local(e, e.currentTarget as HTMLElement)
    const screenRects = rects.get(screen.id) ?? new Map<string, Rect>()
    const keep = e.shiftKey ? editorApi.getState().selection.filter(id => id !== screen.id) : []
    drag(
      e,
      (dx, dy, phase) => {
        const box = {
          x: Math.min(x0, x0 + dx),
          y: Math.min(y0, y0 + dy),
          w: Math.abs(dx),
          h: Math.abs(dy),
        }
        editorApi
          .getState()
          .select([
            ...keep,
            ...marqueeHits(screen, screenRects, box).filter(id => !keep.includes(id)),
          ])
        setDragState(
          phase === "end" ? null : { screen: screen.id, guides: [], drop: null, marquee: box },
        )
      },
      () => !e.shiftKey && editorApi.getState().select([screen.id]),
    )
  }

  const startMove = (screen: Screen, ids: string[], e: React.PointerEvent, onClick: () => void) => {
    const project = projectApi.getState().project
    const screenRects = rects.get(screen.id) ?? new Map<string, Rect>()
    const parent = findParent(project, ids[0])
    if (!parent) return

    // inside auto layout, dragging reorders instead of moving
    if (parent.layout.flex && ids.length === 1) {
      const [px, py] = local(e, artboardOf(e))
      drag(
        e,
        (dx, dy, phase) => {
          const { index, line } = flexDrop(parent, screenRects, ids[0], px + dx, py + dy)
          setDragState({ screen: screen.id, guides: [], drop: line })
          if (phase === "end") {
            setDragState(null)
            edit(d => moveNode(d, ids[0], parent.id, index))
          }
        },
        onClick,
      )
      return
    }

    const moving = ids
      .map(id => findNode(project, id)!)
      .filter(n => isNumber(n.layout.x) && isNumber(n.layout.y))
    if (!moving.length) return
    const boxes = moving.map(n => screenRects.get(n.id)).filter(Boolean) as Rect[]
    const box = boxes.reduce((a, b) => {
      const x = Math.min(a.x, b.x),
        y = Math.min(a.y, b.y)
      return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
    })
    const targets = [
      screenRects.get(parent.id),
      ...parent.children.filter(c => !ids.includes(c.id)).map(c => screenRects.get(c.id)),
    ].filter(Boolean) as Rect[]
    const starts = moving.map(n => ({ id: n.id, x: n.layout.x as number, y: n.layout.y as number }))
    drag(
      e,
      (dx, dy, phase, ev) => {
        const zoom = editorApi.getState().zoom
        const snapped = ev.altKey
          ? { dx, dy, guides: [] }
          : snapMove(box, targets, Math.round(dx), Math.round(dy), 5 / zoom)
        setDragState(
          phase === "end" ? null : { screen: screen.id, guides: snapped.guides, drop: null },
        )
        edit(d => {
          for (const s of starts) {
            const n = locate(d, s.id)?.node
            if (n) {
              n.layout.x = Math.round(s.x + snapped.dx)
              n.layout.y = Math.round(s.y + snapped.dy)
            }
          }
        }, phase)
      },
      onClick,
    )
  }

  /** A layer past the screen's edge, caught by its outline there: select it and drag it back. */
  const onOffscreenPointerDown = (screen: Screen, id: string, e: React.PointerEvent) => {
    if (spaceDown || e.button === 1) return panBy(e)
    if (e.button !== 0) return
    e.stopPropagation()
    const { selection, select } = editorApi.getState()
    if (e.shiftKey)
      return select(
        selection.includes(id)
          ? selection.filter(x => x !== id)
          : [...selection.filter(x => x !== screen.id), id],
      )
    const ids = selection.includes(id) ? selection : [id]
    select(ids)
    startMove(screen, ids, e, () => select([id]))
  }

  /** Double-click: edit a selected text in place, otherwise select one level deeper. */
  const onArtboardDoubleClick = (screen: Screen, e: React.MouseEvent) => {
    const chain = chainAt(screen, e)
    const { selection } = editorApi.getState()
    const selected = chain.find(n => n.id === selection[0])
    if (
      selected &&
      typeof selected.props.text === "string" &&
      !selected.component &&
      !selected.bindings.some(b => b.kind === "text")
    )
      return setEditing({ screen: screen.id, id: selected.id })
    const next = pickDeeper(chain, selection)
    if (next) editorApi.getState().select([next.id])
  }

  const onArtboardPointerMove = (screen: Screen, e: React.PointerEvent) => {
    if (e.buttons) return
    const target = pickTarget(
      chainAt(screen, e),
      editorApi.getState().selection,
      e.metaKey || e.ctrlKey,
    )
    if (editorApi.getState().hover !== target.id) editorApi.getState().setHover(target.id)
  }

  const onHandlePointerDown = (
    screen: Screen,
    id: string,
    handle: Handle,
    e: React.PointerEvent,
  ) => {
    e.stopPropagation()
    const node = findNode(projectApi.getState().project, id)
    const r = rects.get(screen.id)?.get(id)
    if (!node || !r) return
    const start = {
      x: isNumber(node.layout.x) ? node.layout.x : 0,
      y: isNumber(node.layout.y) ? node.layout.y : 0,
      w: isNumber(node.layout.w) ? node.layout.w : r.w,
      h: isNumber(node.layout.h) ? node.layout.h : r.h,
    }
    drag(e, (dx, dy, phase, ev) =>
      edit(d => {
        const n = locate(d, id)?.node
        if (!n) return
        const next = resizeLayout(start, n.layout.align, handle, dx, dy, ev.shiftKey)
        if (handle !== "e" && handle !== "w") n.layout.h = next.h
        if (handle !== "n" && handle !== "s") n.layout.w = next.w
        if (isNumber(n.layout.x)) n.layout.x = next.x
        if (isNumber(n.layout.y)) n.layout.y = next.y
      }, phase),
    )
  }

  const onTitlePointerDown = (screen: Screen, e: React.PointerEvent) => {
    e.stopPropagation()
    if (spaceDown || e.button === 1) return panBy(e)
    editorApi.getState().select([screen.id])
    const start = screen.frame
    drag(e, (dx, dy, phase) =>
      edit(d => {
        const s = d.screens.find(s => s.id === screen.id)
        if (s) s.frame = { x: Math.round(start.x + dx), y: Math.round(start.y + dy) }
      }, phase),
    )
  }

  /** The screen under a canvas point, its name included. */
  const screenAt = (p: Point) => {
    const { screens, target } = projectApi.getState().project
    const { width, height } = target.display
    return screens.find(
      s =>
        p.x >= s.frame.x &&
        p.x <= s.frame.x + width &&
        p.y >= s.frame.y - 24 &&
        p.y <= s.frame.y + height,
    )
  }

  /** Drag from a widget's noodle handle onto a screen: a click on the widget opens it. */
  const onNoodlePointerDown = (screen: Screen, id: string, e: React.PointerEvent) => {
    e.stopPropagation()
    const r = rects.get(screen.id)?.get(id)
    const el = viewport.current
    if (!r || !el) return
    const from = { x: screen.frame.x + r.x + r.w, y: screen.frame.y + r.y + r.h / 2 }
    const box = el.getBoundingClientRect()
    drag(e, (_dx, _dy, phase, ev) => {
      const { zoom, pan } = editorApi.getState()
      const to = {
        x: (ev.clientX - box.left - pan.x) / zoom,
        y: (ev.clientY - box.top - pan.y) / zoom,
      }
      const over = screenAt(to)
      const target = over && over.id !== screen.id ? over.id : null
      if (phase !== "end") return setNoodle({ from, to, target })
      setNoodle(null)
      if (target) navigateOnClick(id, target)
    })
  }

  return {
    project,
    preview,
    rects,
    zoom,
    pan,
    selection,
    hover,
    viewport,
    spaceDown,
    dragState,
    fit,
    zoomCenter,
    attach: (screenId: string, canvas: HTMLCanvasElement | null) =>
      preview?.attach(screenId, canvas),
    onViewportPointerDown,
    onArtboardPointerDown,
    onArtboardPointerMove,
    onArtboardDoubleClick,
    onArtboardPointerLeave: () => editorApi.getState().setHover(null),
    onHandlePointerDown,
    onTitlePointerDown,
    onOffscreenPointerDown,
    setHover: editorApi.getState().setHover,
    pixelGrid: useSettings(s => s.pixelGrid),
    showFlows,
    flows,
    noodle,
    onNoodlePointerDown,
    editing,
    finishEditing: (text: string | null) => {
      if (editing && text !== null) edit(d => void (locate(d, editing.id)!.node.props.text = text))
      setEditing(null)
    },
  }
}

export type CanvasViewModel = ReturnType<typeof useCanvas>
