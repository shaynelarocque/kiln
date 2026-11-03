import { Maximize, Minus, Plus } from "lucide-react"
import { findNode, type Screen } from "@/entities/project"
import { SizeBar } from "@/features/sizes"
import { fontFamily } from "@/shared/lib/font-faces"
import { parseTtfFont } from "@/shared/lvgl"
import { IconButton } from "@/shared/ui"
import type { Handle } from "../model/interactions"
import { useCanvas, type CanvasViewModel, type Flow } from "../model/use-canvas"
import s from "./canvas.module.css"

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

/** Rounds to the nearest device pixel, so layers and outlines don't land between pixels. */
const snap = (v: number) => Math.round(v * devicePixelRatio) / devicePixelRatio

export function Canvas() {
  const vm = useCanvas()
  const { width, height, round } = vm.project.target.display
  return (
    <div
      ref={vm.viewport}
      className={`${s.viewport} ${vm.spaceDown ? s.panning : ""}`}
      onPointerDown={vm.onViewportPointerDown}
      style={{
        backgroundPosition: `${vm.pan.x}px ${vm.pan.y}px`,
        backgroundSize: `${16 * vm.zoom}px ${16 * vm.zoom}px`,
      }}
    >
      {/* The world only ever translates. Everything in it is laid out at screen size (canvas
          units × zoom), because a CSS scale makes WebKit stretch a 1× bitmap of the layer:
          blurry text, and smeared pixels on canvases under its 2D acceleration size. */}
      <div
        className={s.world}
        style={{ transform: `translate(${snap(vm.pan.x)}px, ${snap(vm.pan.y)}px)` }}
      >
        {vm.project.screens.map(screen => (
          <Artboard
            key={screen.id}
            vm={vm}
            screen={screen}
            width={width}
            height={height}
            round={round && !screen.library}
          />
        ))}
        {vm.showFlows && <Flows vm={vm} />}
      </div>
      <SizeBar />
      <div className={s.zoom}>
        <IconButton label='Zoom out (−)' onClick={() => vm.zoomCenter(vm.zoom / 1.25)}>
          <Minus />
        </IconButton>
        <button className={s.zoomValue} onClick={() => vm.zoomCenter(1)} title='Zoom to 100% (⇧0)'>
          {Math.round(vm.zoom * 100)}%
        </button>
        <IconButton label='Zoom in (+)' onClick={() => vm.zoomCenter(vm.zoom * 1.25)}>
          <Plus />
        </IconButton>
        <IconButton label='Fit screens (⇧1)' onClick={vm.fit}>
          <Maximize />
        </IconButton>
      </div>
    </div>
  )
}

function Artboard({
  vm,
  screen,
  width,
  height,
  round,
}: {
  vm: CanvasViewModel
  screen: Screen
  width: number
  height: number
  round: boolean
}) {
  const rects = vm.rects.get(screen.id)
  const selected = vm.selection.includes(screen.id)
  const nodes = vm.selection.filter(id => id !== screen.id && rects?.has(id))
  const single = nodes.length === 1 ? findNode(vm.project, nodes[0]) : undefined
  const singleRect = single && rects?.get(single.id)
  const hover =
    vm.hover && vm.hover !== screen.id && !vm.selection.includes(vm.hover)
      ? rects?.get(vm.hover)
      : undefined
  const drag = vm.dragState?.screen === screen.id ? vm.dragState : null
  const z = vm.zoom

  return (
    <div
      className={s.artboard}
      style={{
        left: snap(screen.frame.x * z),
        top: snap(screen.frame.y * z),
        width: width * z,
        height: height * z,
      }}
    >
      <div
        className={`${s.title} ${selected ? s.titleOn : ""}`}
        onPointerDown={e => vm.onTitlePointerDown(screen, e)}
      >
        {screen.name}
      </div>
      <div
        className={`${s.frame} ${round ? s.round : ""} ${selected ? s.frameOn : ""} ${vm.noodle?.target === screen.id ? s.noodleTarget : ""}`}
        onPointerDown={e => vm.onArtboardPointerDown(screen, e)}
        onPointerMove={e => vm.onArtboardPointerMove(screen, e)}
        onPointerLeave={vm.onArtboardPointerLeave}
        onDoubleClick={e => vm.onArtboardDoubleClick(screen, e)}
      >
        <canvas
          ref={el => vm.attach(screen.id, el)}
          width={width}
          height={height}
          className={s.pixels}
        />
      </div>
      <div className={s.overlay}>
        {hover && <Box rect={hover} z={z} className={s.hover} />}
        {nodes.map(id => {
          const r = rects!.get(id)!
          return <Box key={id} rect={r} z={z} className={s.selected} />
        })}
        {single && singleRect && vm.showFlows && (
          <span
            className={s.noodleHandle}
            title='Drag onto a screen to open it on click'
            style={{
              left: (singleRect.x + singleRect.w) * z,
              top: (singleRect.y + singleRect.h / 2) * z,
            }}
            onPointerDown={e => vm.onNoodlePointerDown(screen, single.id, e)}
          />
        )}
        {single && singleRect && !vm.showFlows && (
          <>
            {HANDLES.map(h => (
              <span
                key={h}
                className={`${s.handle} ${s[h]}`}
                style={{
                  left:
                    (singleRect.x +
                      (h.includes("e") ? singleRect.w : h.includes("w") ? 0 : singleRect.w / 2)) *
                    z,
                  top:
                    (singleRect.y +
                      (h.includes("s") ? singleRect.h : h.includes("n") ? 0 : singleRect.h / 2)) *
                    z,
                }}
                onPointerDown={e => vm.onHandlePointerDown(screen, single.id, h, e)}
              />
            ))}
            <span
              className={s.badge}
              style={{
                left: (singleRect.x + singleRect.w / 2) * z,
                top: (singleRect.y + singleRect.h) * z,
              }}
            >
              {singleRect.w} × {singleRect.h}
            </span>
          </>
        )}
        {drag?.guides.map((g, i) => (
          <span
            key={i}
            className={s.guide}
            style={
              g.axis === "x"
                ? { left: snap(g.at * z), top: 0, height: height * z }
                : { top: snap(g.at * z), left: 0, width: width * z }
            }
            data-axis={g.axis}
          />
        ))}
        {drag?.drop && <Box rect={drag.drop} z={z} className={s.drop} />}
        {drag?.marquee && <Box rect={drag.marquee} z={z} className={s.marquee} />}
        {vm.editing?.screen === screen.id && rects?.get(vm.editing.id) && (
          <TextEditor vm={vm} rect={rects.get(vm.editing.id)!} />
        )}
      </div>
    </div>
  )
}

/** In-place text editing over a label, sized to its font. */
function TextEditor({
  vm,
  rect,
}: {
  vm: CanvasViewModel
  rect: { x: number; y: number; w: number; h: number }
}) {
  const node = findNode(vm.project, vm.editing!.id)!
  const font = String(node.style["main:default"]?.text_font ?? "lv_font_montserrat_14")
  const size = Number(/(\d+)$/.exec(font)?.[1] ?? 14)
  const ttf = parseTtfFont(font)
  const file = ttf && vm.project.fonts.find(f => f.id === ttf.id)
  const z = vm.zoom
  return (
    <textarea
      className={s.textEdit}
      autoFocus
      defaultValue={String(node.props.text)}
      style={{
        left: (rect.x - 2) * z,
        top: (rect.y - 2) * z,
        minWidth: (rect.w + 24) * z,
        minHeight: (rect.h + 4) * z,
        padding: 2 * z,
        fontSize: size * z,
        fontFamily: file ? `${fontFamily(file.id, file.data)}, Montserrat` : undefined,
      }}
      onFocus={e => e.target.select()}
      onBlur={e => vm.finishEditing(e.target.value)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === "Escape") vm.finishEditing(null)
        if (e.key === "Enter" && !e.shiftKey)
          (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())
      }}
      onPointerDown={e => e.stopPropagation()}
    />
  )
}

/** An outline around a box in display pixels, drawn on device pixels so it stays a crisp line. */
function Box({
  rect,
  z,
  className,
}: {
  rect: { x: number; y: number; w: number; h: number }
  z: number
  className: string
}) {
  const [x, y] = [snap(rect.x * z), snap(rect.y * z)]
  return (
    <span
      className={className}
      style={{
        left: x,
        top: y,
        width: snap((rect.x + rect.w) * z) - x,
        height: snap((rect.y + rect.h) * z) - y,
      }}
    />
  )
}

/** One noodle: leaves the widget rightwards and enters the screen from the side facing it. */
function noodlePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const ahead = to.x >= from.x
  const reach = Math.max(40, Math.abs(to.x - from.x) / 2)
  return `M ${from.x} ${from.y} C ${from.x + reach} ${from.y}, ${ahead ? to.x - reach : to.x + reach} ${to.y}, ${to.x} ${to.y}`
}

/** An arrowhead at `to`, sized for the screen rather than the canvas. */
function head(from: { x: number; y: number }, to: { x: number; y: number }, zoom: number) {
  const dir = to.x >= from.x ? 1 : -1
  const size = 8 / zoom
  return `${to.x},${to.y} ${to.x - dir * size},${to.y - size * 0.6} ${to.x - dir * size},${to.y + size * 0.6}`
}

/** Prototype noodles over the canvas: every navigation, plus the one being dragged out. */
function Flows({ vm }: { vm: CanvasViewModel }) {
  const all: (Flow & { live?: boolean })[] = [...vm.flows]
  if (vm.noodle)
    all.push({ id: "live", from: vm.noodle.from, to: vm.noodle.to, selected: true, live: true })
  // an SVG transform, unlike a CSS one, is drawn as vectors at the final size
  return (
    <svg className={s.flows} width='1' height='1' aria-hidden>
      <g transform={`scale(${vm.zoom})`}>
        {all.map(f => (
          <g
            key={f.id}
            className={`${s.flow} ${f.selected ? s.flowOn : ""} ${f.live ? s.flowLive : ""}`}
          >
            <circle cx={f.from.x} cy={f.from.y} r={3 / vm.zoom} />
            <path d={noodlePath(f.from, f.to)} vectorEffect='non-scaling-stroke' />
            <polygon points={head(f.from, f.to, vm.zoom)} />
          </g>
        ))}
      </g>
    </svg>
  )
}
