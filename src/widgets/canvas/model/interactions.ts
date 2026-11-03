import type { Layout, Node } from "@/entities/project"
import { alignFactors, type Rect } from "@/shared/lvgl"

export type Rects = Map<string, Rect>
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"
export type Guide = { axis: "x" | "y"; at: number }

const inside = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h

/** The nodes under a point, from the screen down to the deepest one drawn on top. */
export function hitChain(screen: Node, rects: Rects, x: number, y: number): Node[] {
  const chain: Node[] = [screen]
  let level: Node = screen
  for (;;) {
    let next: Node | undefined
    // later siblings draw on top, so the last hit wins
    for (const child of level.children) {
      const r = rects.get(child.id)
      if (r && !child.hidden && !child.locked && inside(r, x, y)) next = child
    }
    if (!next) return chain
    chain.push(next)
    level = next
  }
}

/** The screen's top-level layers a marquee touches; like Figma, overlapping is enough. */
export function marqueeHits(screen: Node, rects: Rects, box: Rect): string[] {
  return screen.children
    .filter(c => {
      const r = rects.get(c.id)
      return (
        r &&
        !c.hidden &&
        !c.locked &&
        r.x < box.x + box.w &&
        box.x < r.x + r.w &&
        r.y < box.y + box.h &&
        box.y < r.y + r.h
      )
    })
    .map(c => c.id)
}

/**
 * Figma's selection rules: a click picks the top-level layer under the cursor, or the
 * one at the depth you're already working at; deep picks the innermost.
 */
export function pickTarget(chain: Node[], selection: string[], deep: boolean): Node {
  if (deep || chain.length === 1) return chain.at(-1)!
  const selected = selection[0]
  const at = chain.findIndex(n => n.id === selected)
  if (at > 0) return chain[at]
  // the selection is a sibling of something in the chain: stay at that depth
  for (let i = chain.length - 1; i > 0; i--)
    if (chain[i - 1].children.some(c => c.id === selected)) return chain[i]
  return chain[1]
}

/** One level deeper than the current selection along the chain (double-click). */
export function pickDeeper(chain: Node[], selection: string[]): Node | undefined {
  const at = chain.findIndex(n => n.id === selection[0])
  return at >= 0 ? chain[at + 1] : chain[1]
}

/**
 * Snaps a moved box to the parent's and siblings' edges and centres.
 * Returns the adjusted offset plus the guide lines it snapped to.
 */
export function snapMove(box: Rect, targets: Rect[], dx: number, dy: number, threshold: number) {
  const guides: Guide[] = []
  const snap = (axis: "x" | "y", d: number) => {
    const [pos, size] = axis === "x" ? [box.x + d, box.w] : [box.y + d, box.h]
    const edges = [pos, pos + size / 2, pos + size]
    let best: { delta: number; at: number } | null = null
    for (const t of targets) {
      const [tp, ts] = axis === "x" ? [t.x, t.w] : [t.y, t.h]
      for (const line of [tp, tp + ts / 2, tp + ts])
        for (const e of edges) {
          const delta = line - e
          if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta)))
            best = { delta, at: line }
        }
    }
    if (!best) return d
    guides.push({ axis, at: best.at })
    return d + best.delta
  }
  return { dx: snap("x", dx), dy: snap("y", dy), guides }
}

/**
 * New x/y/w/h after dragging a handle, keeping the opposite edge still whatever the
 * alignment (a centred box has to move half the distance it grows).
 */
export function resizeLayout(
  start: { x: number; y: number; w: number; h: number },
  align: string,
  handle: Handle,
  dx: number,
  dy: number,
  keepRatio = false,
) {
  const [ax, ay] = alignFactors(align)
  let { x, y, w, h } = start
  if (handle.includes("e")) {
    const dw = Math.max(1 - start.w, dx)
    w = start.w + dw
    x = start.x + ax * dw
  }
  if (handle.includes("w")) {
    const dw = Math.max(1 - start.w, -dx)
    w = start.w + dw
    x = start.x - (1 - ax) * dw
  }
  if (handle.includes("s")) {
    const dh = Math.max(1 - start.h, dy)
    h = start.h + dh
    y = start.y + ay * dh
  }
  if (handle.includes("n")) {
    const dh = Math.max(1 - start.h, -dy)
    h = start.h + dh
    y = start.y - (1 - ay) * dh
  }
  if (keepRatio && handle.length === 2) {
    const ratio = start.w / start.h
    const dh = Math.round(w / ratio) - h
    h += dh
    y += (handle.includes("n") ? -(1 - ay) : ay) * dh
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/**
 * Where a dragged child would land among its flex siblings: next to the sibling nearest the
 * pointer (which copes with wrapped rows), on the side the pointer is on, flipped for *_REVERSE flows.
 * `index` is an insertion point in the full children list, as moveNode takes it.
 */
export function flexDrop(parent: Node, rects: Rects, dragged: string, x: number, y: number) {
  const flow = parent.layout.flex?.flow ?? ""
  const column = flow.includes("COLUMN")
  const reverse = flow.includes("REVERSE")
  let nearest: { id: string; r: Rect; d: number } | null = null
  for (const child of parent.children) {
    const r = rects.get(child.id)
    if (child.id === dragged || !r) continue
    const d = Math.hypot(x - (r.x + r.w / 2), y - (r.y + r.h / 2))
    if (!nearest || d < nearest.d) nearest = { id: child.id, r, d }
  }
  if (!nearest) return { index: 0, line: null }
  const { r } = nearest
  const past = column ? y > r.y + r.h / 2 : x > r.x + r.w / 2
  const after = past !== reverse
  const index = parent.children.findIndex(c => c.id === nearest!.id) + (after ? 1 : 0)
  // the line sits on the side of the nearest sibling the pointer is on
  const line: Rect = column
    ? { x: r.x, y: past ? r.y + r.h + 1 : r.y - 1, w: r.w, h: 0 }
    : { x: past ? r.x + r.w + 1 : r.x - 1, y: r.y, w: 0, h: r.h }
  return { index, line }
}

export const isNumber = (v: Layout["x"]): v is number => typeof v === "number"
