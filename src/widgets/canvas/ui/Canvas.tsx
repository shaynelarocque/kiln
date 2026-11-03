import { Maximize, Minus, Plus } from "lucide-react"
import { findNode, type Screen } from "@/entities/project"
import { IconButton } from "@/shared/ui"
import type { Handle } from "../model/interactions"
import { useCanvas, type CanvasViewModel } from "../model/use-canvas"
import s from "./canvas.module.css"

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

export function Canvas() {
  const vm = useCanvas()
  const { width, height, round } = vm.project.target.display
  return (
    <div
      ref={vm.viewport}
      className={`${s.viewport} ${vm.spaceDown ? s.panning : ""}`}
      onPointerDown={vm.onViewportPointerDown}
      style={{ "--z": vm.zoom, backgroundPosition: `${vm.pan.x}px ${vm.pan.y}px`, backgroundSize: `${16 * vm.zoom}px ${16 * vm.zoom}px` } as React.CSSProperties}
    >
      <div className={s.world} style={{ transform: `translate(${vm.pan.x}px, ${vm.pan.y}px) scale(${vm.zoom})` }}>
        {vm.project.screens.map(screen => (
          <Artboard key={screen.id} vm={vm} screen={screen} width={width} height={height} round={round} />
        ))}
      </div>
      <div className={s.zoom}>
        <IconButton label='Zoom out' onClick={() => vm.zoomAt(vm.zoom / 1.25, vm.viewport.current!.clientWidth / 2, vm.viewport.current!.clientHeight / 2)}>
          <Minus />
        </IconButton>
        <button className={s.zoomValue} onClick={() => vm.zoomAt(1, vm.viewport.current!.clientWidth / 2, vm.viewport.current!.clientHeight / 2)} title='Zoom to 100%'>
          {Math.round(vm.zoom * 100)}%
        </button>
        <IconButton label='Zoom in' onClick={() => vm.zoomAt(vm.zoom * 1.25, vm.viewport.current!.clientWidth / 2, vm.viewport.current!.clientHeight / 2)}>
          <Plus />
        </IconButton>
        <IconButton label='Fit screens (⇧1)' onClick={vm.fit}>
          <Maximize />
        </IconButton>
      </div>
    </div>
  )
}

function Artboard({ vm, screen, width, height, round }: { vm: CanvasViewModel; screen: Screen; width: number; height: number; round: boolean }) {
  const rects = vm.rects.get(screen.id)
  const selected = vm.selection.includes(screen.id)
  const nodes = vm.selection.filter(id => id !== screen.id && rects?.has(id))
  const single = nodes.length === 1 ? findNode(vm.project, nodes[0]) : undefined
  const singleRect = single && rects?.get(single.id)
  const hover = vm.hover && vm.hover !== screen.id && !vm.selection.includes(vm.hover) ? rects?.get(vm.hover) : undefined
  const drag = vm.dragState?.screen === screen.id ? vm.dragState : null

  return (
    <div className={s.artboard} style={{ left: screen.frame.x, top: screen.frame.y, width, height }}>
      <div className={`${s.title} ${selected ? s.titleOn : ""}`} onPointerDown={e => vm.onTitlePointerDown(screen, e)}>
        {screen.name}
      </div>
      <div
        className={`${s.frame} ${round ? s.round : ""} ${selected ? s.frameOn : ""}`}
        onPointerDown={e => vm.onArtboardPointerDown(screen, e)}
        onPointerMove={e => vm.onArtboardPointerMove(screen, e)}
        onPointerLeave={vm.onArtboardPointerLeave}
        onDoubleClick={e => vm.onArtboardDoubleClick(screen, e)}
      >
        <canvas ref={el => vm.attach(screen.id, el)} width={width} height={height} className={s.pixels} />
      </div>
      <div className={s.overlay}>
        {hover && <Box rect={hover} className={s.hover} />}
        {nodes.map(id => {
          const r = rects!.get(id)!
          return <Box key={id} rect={r} className={s.selected} />
        })}
        {single && singleRect && (
          <>
            {HANDLES.map(h => (
              <span
                key={h}
                className={`${s.handle} ${s[h]}`}
                style={{ left: singleRect.x + (h.includes("e") ? singleRect.w : h.includes("w") ? 0 : singleRect.w / 2), top: singleRect.y + (h.includes("s") ? singleRect.h : h.includes("n") ? 0 : singleRect.h / 2) }}
                onPointerDown={e => vm.onHandlePointerDown(screen, single.id, h, e)}
              />
            ))}
            <span className={s.badge} style={{ left: singleRect.x + singleRect.w / 2, top: singleRect.y + singleRect.h }}>
              {singleRect.w} × {singleRect.h}
            </span>
          </>
        )}
        {drag?.guides.map((g, i) => (
          <span key={i} className={s.guide} style={g.axis === "x" ? { left: g.at, top: 0, height } : { top: g.at, left: 0, width }} data-axis={g.axis} />
        ))}
        {drag?.drop && <Box rect={drag.drop} className={s.drop} />}
      </div>
    </div>
  )
}

function Box({ rect, className }: { rect: { x: number; y: number; w: number; h: number }; className: string }) {
  return <span className={className} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
}
