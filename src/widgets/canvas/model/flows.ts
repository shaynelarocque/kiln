/**
 * Routes the prototype noodles so they read at a glance: each leaves its widget on the side
 * facing where it goes and enters the side of the target screen that faces its source. Several
 * landing on one side spread out in the order they come from, so they don't cross, and a pair
 * going both ways between two screens keeps a lane apart instead of drawing over itself.
 */

export type Point = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }
type Side = "left" | "right" | "top" | "bottom"

/** A navigation to draw: the widget's box, its screen and the screen it opens, in canvas units. */
export type FlowInput = {
  id: string
  widget: Box
  screen: { id: string; box: Box }
  target: { id: string; box: Box }
}

/** A routed noodle: where it starts and ends, and the way it heads at each end (unit vectors). */
export type Route = { id: string; from: Point; to: Point; out: Point; in: Point }

/** Apart, in display pixels, of two noodles sharing a side. */
const LANE = 12
/** How far, at least, a noodle runs out of its widget before it turns. */
const LEAD = 40

const INTO: Record<Side, Point> = {
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  top: { x: 0, y: 1 },
  bottom: { x: 0, y: -1 },
}
const OPPOSITE: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" }
/** Where one steps aside of a noodle coming back: rightwards above, leftwards below, down on the right, up on the left. */
const ASIDE: Record<Side, number> = { left: -LANE, right: LANE, top: LANE, bottom: -LANE }

/** The side of `to` that faces `from`. */
function facing(from: Box, to: Box): Side {
  if (to.x >= from.x + from.w) return "left"
  if (to.x + to.w <= from.x) return "right"
  return to.y + to.h / 2 >= from.y + from.h / 2 ? "top" : "bottom"
}

export function routeFlows(flows: FlowInput[]): Route[] {
  const placed = flows.map(f => {
    const side = facing(f.screen.box, f.target.box)
    const t = f.target.box
    // leave sideways, towards the target
    const right =
      side === "left" || (side !== "right" && t.x + t.w / 2 >= f.widget.x + f.widget.w / 2)
    const from = {
      x: right ? f.widget.x + f.widget.w : f.widget.x,
      y: f.widget.y + f.widget.h / 2,
    }
    const out = { x: right ? 1 : -1, y: 0 }
    // where it would land: level with the widget, or below or above where it turns
    const aim = side === "left" || side === "right" ? from.y : from.x + out.x * LEAD
    return { f, side, from, out, aim, at: 0 }
  })

  const sides = new Map<string, typeof placed>()
  for (const p of placed) {
    const key = `${p.f.target.id}:${p.side}`
    sides.set(key, [...(sides.get(key) ?? []), p])
  }

  for (const group of sides.values()) {
    const { id, box: t } = group[0].f.target
    const side = group[0].side
    const across = side === "left" || side === "right"
    const [lo, hi] = across ? [t.y, t.y + t.h] : [t.x, t.x + t.w]
    const margin = Math.min(24, (hi - lo) / 4)
    const clamp = (v: number) => Math.min(hi - margin, Math.max(lo + margin, v))
    // in source order; at a tie, the one that turns later lands further out
    const turn = side === "top" ? 1 : -1
    group.sort((a, b) =>
      across
        ? a.aim - b.aim || a.from.x - b.from.x
        : a.aim - b.aim || (b.from.y - a.from.y) * a.out.x * turn,
    )
    // noodles leaving the target screen through this side, back the way these came
    const leaving = placed
      .filter(p => p.f.screen.id === id && p.side === OPPOSITE[side])
      .map(p => p.aim)
    for (const p of group) {
      p.at = clamp(p.aim)
      const clash = leaving.find(v => Math.abs(v - p.at) < LANE)
      if (clash !== undefined) p.at = clamp(clash + ASIDE[side])
    }
    for (let i = 1; i < group.length; i++)
      group[i].at = Math.max(group[i].at, group[i - 1].at + LANE)
    for (let i = group.length - 1; i >= 0; i--)
      group[i].at = Math.max(
        lo + margin,
        Math.min(group[i].at, i === group.length - 1 ? hi - margin : group[i + 1].at - LANE),
      )
  }

  return placed.map(({ f, side, from, out, at }) => {
    const t = f.target.box
    const to =
      side === "left"
        ? { x: t.x, y: at }
        : side === "right"
          ? { x: t.x + t.w, y: at }
          : side === "top"
            ? { x: at, y: t.y }
            : { x: at, y: t.y + t.h }
    return { id: f.id, from, to, out, in: INTO[side] }
  })
}

/** The noodle's curve: leaves along `out`, arrives along `in`. */
export function noodlePath(r: Pick<Route, "from" | "to" | "out" | "in">) {
  const { from, to } = r
  const dx = Math.abs(to.x - from.x)
  const dy = Math.abs(to.y - from.y)
  const lead = Math.max(LEAD, (r.out.x ? dx : dy) / 2)
  const tail = Math.max(LEAD, (r.in.x ? dx : dy) / 2)
  const c1 = { x: from.x + r.out.x * lead, y: from.y + r.out.y * lead }
  const c2 = { x: to.x - r.in.x * tail, y: to.y - r.in.y * tail }
  return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`
}

/** An arrowhead at the end of a noodle, `size` long, pointing the way it arrives. */
export function arrowhead(to: Point, dir: Point, size: number) {
  const back = { x: to.x - dir.x * size, y: to.y - dir.y * size }
  const side = { x: -dir.y * size * 0.6, y: dir.x * size * 0.6 }
  return `${to.x},${to.y} ${back.x + side.x},${back.y + side.y} ${back.x - side.x},${back.y - side.y}`
}
