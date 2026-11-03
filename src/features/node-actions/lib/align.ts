import type { Rect } from "@/shared/lvgl"

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"
export type Move = { dx: number; dy: number }

/** How far each box moves to share the selection's left/centre/right (or top/middle/bottom), like Figma. */
export function alignMoves(boxes: Rect[], edge: AlignEdge): Move[] {
  const x1 = Math.min(...boxes.map(b => b.x))
  const x2 = Math.max(...boxes.map(b => b.x + b.w))
  const y1 = Math.min(...boxes.map(b => b.y))
  const y2 = Math.max(...boxes.map(b => b.y + b.h))
  return boxes.map(b => {
    switch (edge) {
      case "left":
        return { dx: x1 - b.x, dy: 0 }
      case "right":
        return { dx: x2 - b.x - b.w, dy: 0 }
      case "hcenter":
        return { dx: Math.round((x1 + x2 - b.w) / 2 - b.x), dy: 0 }
      case "top":
        return { dx: 0, dy: y1 - b.y }
      case "bottom":
        return { dx: 0, dy: y2 - b.y - b.h }
      case "vcenter":
        return { dx: 0, dy: Math.round((y1 + y2 - b.h) / 2 - b.y) }
    }
  })
}

/** Equal gaps between boxes along an axis; the first and last stay put. */
export function distributeMoves(boxes: Rect[], axis: "x" | "y"): Move[] {
  const pos = (b: Rect) => (axis === "x" ? b.x : b.y)
  const size = (b: Rect) => (axis === "x" ? b.w : b.h)
  const order = boxes.map((b, i) => ({ b, i })).sort((a, c) => pos(a.b) - pos(c.b))
  const first = order[0].b
  const last = order.at(-1)!.b
  const gap =
    (pos(last) + size(last) - pos(first) - order.reduce((s, o) => s + size(o.b), 0)) /
    (boxes.length - 1)
  const moves = boxes.map(() => ({ dx: 0, dy: 0 }))
  let at = pos(first)
  for (const { b, i } of order) {
    const d = Math.round(at - pos(b))
    moves[i] = axis === "x" ? { dx: d, dy: 0 } : { dx: 0, dy: d }
    at += size(b) + gap
  }
  return moves
}
