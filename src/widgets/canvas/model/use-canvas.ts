import { useCallback, useEffect, useRef, useState } from "react"
import { editorApi, useEditorStore } from "@/entities/editor"
import { edit, findNode, findParent, locate, moveNode, projectApi, useProjectStore, type Phase, type Screen } from "@/entities/project"
import type { Rect } from "@/shared/lvgl"
import { flexDrop, hitChain, isNumber, pickDeeper, pickTarget, resizeLayout, snapMove, type Guide, type Handle } from "./interactions"
import { usePreview } from "./use-preview"

export type DragState = { screen: string; guides: Guide[]; drop: Rect | null }

const MIN_ZOOM = 0.1
const MAX_ZOOM = 16

/** Follows a pointer until release, reporting the offset in canvas pixels and the gesture phase. */
function drag(e: React.PointerEvent, onMove: (dx: number, dy: number, phase: Phase, ev: PointerEvent) => void, onClick?: () => void) {
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
  const { preview, rects } = usePreview()
  const project = useProjectStore(s => s.project)
  const { zoom, pan, selection, hover } = useEditorStore()
  const viewport = useRef<HTMLDivElement>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [editing, setEditing] = useState<{ screen: string; id: string } | null>(null)

  const setView = editorApi.getState().setView

  const zoomAt = useCallback((next: number, cx: number, cy: number) => {
    const { zoom, pan } = editorApi.getState()
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    setView(z, { x: cx - ((cx - pan.x) * z) / zoom, y: cy - ((cy - pan.y) * z) / zoom })
  }, [setView])

  const fit = useCallback(() => {
    const el = viewport.current
    const { screens, target } = projectApi.getState().project
    if (!el || !screens.length) return
    const { width: w, height: h } = target.display
    const x1 = Math.min(...screens.map(s => s.frame.x)), y1 = Math.min(...screens.map(s => s.frame.y)) - 24
    const x2 = Math.max(...screens.map(s => s.frame.x + w)), y2 = Math.max(...screens.map(s => s.frame.y + h))
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((el.clientWidth - 120) / (x2 - x1), (el.clientHeight - 120) / (y2 - y1))))
    setView(z, { x: (el.clientWidth - (x2 - x1) * z) / 2 - x1 * z, y: (el.clientHeight - (y2 - y1) * z) / 2 - y1 * z })
  }, [setView])

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
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e)) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

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
    if (e.shiftKey) {
      select(selection.includes(target.id) ? selection.filter(id => id !== target.id) : [...selection.filter(id => id !== screen.id), target.id])
      return
    }
    const ids = selection.includes(target.id) ? selection : [target.id]
    select(ids)
    if (target.widget !== "screen") startMove(screen, ids, e)
  }

  const startMove = (screen: Screen, ids: string[], e: React.PointerEvent) => {
    const project = projectApi.getState().project
    const screenRects = rects.get(screen.id) ?? new Map<string, Rect>()
    const parent = findParent(project, ids[0])
    if (!parent) return

    // inside auto layout, dragging reorders instead of moving
    if (parent.layout.flex && ids.length === 1) {
      const [px, py] = local(e, e.currentTarget as HTMLElement)
      drag(e, (dx, dy, phase) => {
        const { index, line } = flexDrop(parent, screenRects, ids[0], px + dx, py + dy)
        setDragState({ screen: screen.id, guides: [], drop: line })
        if (phase === "end") {
          setDragState(null)
          edit(d => moveNode(d, ids[0], parent.id, index))
        }
      })
      return
    }

    const moving = ids.map(id => findNode(project, id)!).filter(n => isNumber(n.layout.x) && isNumber(n.layout.y))
    if (!moving.length) return
    const boxes = moving.map(n => screenRects.get(n.id)).filter(Boolean) as Rect[]
    const box = boxes.reduce((a, b) => {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
      return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
    })
    const targets = [screenRects.get(parent.id), ...parent.children.filter(c => !ids.includes(c.id)).map(c => screenRects.get(c.id))].filter(Boolean) as Rect[]
    const starts = moving.map(n => ({ id: n.id, x: n.layout.x as number, y: n.layout.y as number }))
    drag(e, (dx, dy, phase, ev) => {
      const zoom = editorApi.getState().zoom
      const snapped = ev.altKey ? { dx, dy, guides: [] } : snapMove(box, targets, Math.round(dx), Math.round(dy), 5 / zoom)
      setDragState(phase === "end" ? null : { screen: screen.id, guides: snapped.guides, drop: null })
      edit(d => {
        for (const s of starts) {
          const n = locate(d, s.id)?.node
          if (n) {
            n.layout.x = Math.round(s.x + snapped.dx)
            n.layout.y = Math.round(s.y + snapped.dy)
          }
        }
      }, phase)
    })
  }

  /** Double-click: edit a selected text in place, otherwise select one level deeper. */
  const onArtboardDoubleClick = (screen: Screen, e: React.MouseEvent) => {
    const chain = chainAt(screen, e)
    const { selection } = editorApi.getState()
    const selected = chain.find(n => n.id === selection[0])
    if (selected && typeof selected.props.text === "string" && !selected.component && !selected.bindings.some(b => b.kind === "text"))
      return setEditing({ screen: screen.id, id: selected.id })
    const next = pickDeeper(chain, selection)
    if (next) editorApi.getState().select([next.id])
  }

  const onArtboardPointerMove = (screen: Screen, e: React.PointerEvent) => {
    if (e.buttons) return
    const target = pickTarget(chainAt(screen, e), editorApi.getState().selection, e.metaKey || e.ctrlKey)
    if (editorApi.getState().hover !== target.id) editorApi.getState().setHover(target.id)
  }

  const onHandlePointerDown = (screen: Screen, id: string, handle: Handle, e: React.PointerEvent) => {
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
    zoomAt,
    attach: (screenId: string, canvas: HTMLCanvasElement | null) => preview?.attach(screenId, canvas),
    onViewportPointerDown,
    onArtboardPointerDown,
    onArtboardPointerMove,
    onArtboardDoubleClick,
    onArtboardPointerLeave: () => editorApi.getState().setHover(null),
    onHandlePointerDown,
    onTitlePointerDown,
    editing,
    finishEditing: (text: string | null) => {
      if (editing && text !== null) edit(d => void (locate(d, editing.id)!.node.props.text = text))
      setEditing(null)
    },
  }
}

export type CanvasViewModel = ReturnType<typeof useCanvas>
