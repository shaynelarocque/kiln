import { Maximize, Minus, Plus } from "lucide-react"
import { findNode, type Screen } from "@/entities/project"
import { ComponentMenu } from "@/features/components"
import { InsertBar } from "@/features/insert-widget"
import { SizeBar } from "@/features/sizes"
import { fontFamily } from "@/shared/lib/font-faces"
import { parseTtfFont } from "@/shared/lvgl"
import { IconButton } from "@/shared/ui"
import { arrowhead, noodlePath } from "../model/flows"
import { offscreen, type Handle } from "../model/interactions"
import { useCanvas, type CanvasViewModel, type Flow } from "../model/use-canvas"
import s from "./canvas.module.css"

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

/** Zoom at which display pixels are big enough to draw a grid between them. */
const PIXEL_GRID_ZOOM = 6

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
      {/* docked to the bottom of the canvas, like Figma's */}
      <div className={s.insert} role='toolbar' aria-label='Insert'>
        <InsertBar />
        <ComponentMenu />
      </div>
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
  const outside = rects ? offscreen(screen, rects, width, height) : []

  return (
    <div
      className={s.artboard}
      data-artboard
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
      {outside.map(({ node, rect }) => (
        <Offscreen
          key={node.id}
          name={node.name}
          rect={rect}
          z={z}
          screen={{ w: width, h: height }}
          onPointerDown={e => vm.onOffscreenPointerDown(screen, node.id, e)}
          onPointerEnter={() => vm.setHover(node.id)}
          onPointerLeave={() => vm.setHover(null)}
        />
      ))}
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
        {vm.pixelGrid && z >= PIXEL_GRID_ZOOM && (
          <span
            className={`${s.pixelGrid} ${round ? s.round : ""}`}
            style={{ backgroundSize: `${z}px ${z}px` }}
          />
        )}
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

type Box = { x: number; y: number; w: number; h: number }

/**
 * A layer that reaches past the screen's edge, where LVGL can't draw it: a dashed outline
 * under the artboard (so only the part outside shows), named in its biggest part outside.
 */
function Offscreen({
  name,
  rect,
  z,
  screen,
  ...events
}: {
  name: string
  rect: Box
  z: number
  screen: { w: number; h: number }
} & Pick<
  React.HTMLAttributes<HTMLSpanElement>,
  "onPointerDown" | "onPointerEnter" | "onPointerLeave"
>) {
  const r = rect
  const parts: Box[] = [
    { x: r.x, y: r.y, w: Math.min(r.w, -r.x), h: r.h },
    { x: Math.max(r.x, screen.w), y: r.y, w: r.x + r.w - Math.max(r.x, screen.w), h: r.h },
    { x: r.x, y: r.y, w: r.w, h: Math.min(r.h, -r.y) },
    { x: r.x, y: Math.max(r.y, screen.h), w: r.w, h: r.y + r.h - Math.max(r.y, screen.h) },
  ].filter(p => p.w > 0 && p.h > 0)
  const label = parts.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a), parts[0] ?? r)
  const [x, y] = [snap(r.x * z), snap(r.y * z)]
  return (
    <span
      className={s.offscreen}
      title={`${name} is past the screen's edge, so the board won't show it. Drag it back.`}
      style={{
        left: x,
        top: y,
        width: snap((r.x + r.w) * z) - x,
        height: snap((r.y + r.h) * z) - y,
      }}
      {...events}
    >
      <em
        style={{
          left: (label.x - r.x) * z,
          top: (label.y - r.y) * z,
          maxWidth: label.w * z,
        }}
      >
        {name}
      </em>
    </span>
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

/** Prototype noodles over the canvas: every navigation, plus the one being dragged out. */
function Flows({ vm }: { vm: CanvasViewModel }) {
  const all: (Flow & { live?: boolean })[] = [...vm.flows]
  if (vm.noodle) {
    const { from, to } = vm.noodle
    // the one being dragged leaves rightwards and arrives at the pointer, facing where it went
    const ahead = { x: to.x >= from.x ? 1 : -1, y: 0 }
    all.push({ id: "live", from, to, out: { x: 1, y: 0 }, in: ahead, selected: true, live: true })
  }
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
            <path d={noodlePath(f)} vectorEffect='non-scaling-stroke' />
            <polygon points={arrowhead(f.to, f.in, 8 / vm.zoom)} />
          </g>
        ))}
      </g>
    </svg>
  )
}
