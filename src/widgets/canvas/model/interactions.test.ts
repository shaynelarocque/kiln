import { describe, expect, it } from "vitest"
import { createNode } from "@/entities/project"
import { alignFactors, flexIndex, hitChain, pickDeeper, pickTarget, resizeLayout, snapMove, type Rects } from "./interactions"

function tree() {
  const screen = createNode("screen", { name: "s" })
  const card = createNode("container", { name: "card" })
  const label = createNode("label", { name: "label" })
  const top = createNode("button", { name: "top", children: [] })
  card.children = [label]
  screen.children = [card, top]
  const rects: Rects = new Map([
    [screen.id, { x: 0, y: 0, w: 240, h: 240 }],
    [card.id, { x: 20, y: 20, w: 100, h: 100 }],
    [label.id, { x: 30, y: 30, w: 40, h: 20 }],
    [top.id, { x: 100, y: 100, w: 60, h: 60 }],
  ])
  return { screen, card, label, top, rects }
}

describe("hit testing", () => {
  it("follows the topmost, deepest node", () => {
    const { screen, card, label, top, rects } = tree()
    expect(hitChain(screen, rects, 35, 35).map(n => n.name)).toEqual(["s", "card", "label"])
    // `top` comes later, so it draws over the card where they overlap
    expect(hitChain(screen, rects, 110, 110).at(-1)).toBe(top)
    expect(pickTarget(hitChain(screen, rects, 35, 35), [], false)).toBe(card)
    expect(pickTarget(hitChain(screen, rects, 35, 35), [], true)).toBe(label)
    expect(pickDeeper(hitChain(screen, rects, 35, 35), [card.id])).toBe(label)
    // working inside the card: a click on a sibling of the selection stays at that depth
    expect(pickTarget(hitChain(screen, rects, 35, 35), [label.id], false)).toBe(label)
  })

  it("skips hidden and locked nodes", () => {
    const { screen, card, rects } = tree()
    card.hidden = true
    expect(hitChain(screen, rects, 35, 35)).toEqual([screen])
  })
})

describe("geometry", () => {
  it("reads LVGL alignments", () => {
    expect(alignFactors("LV_ALIGN_TOP_LEFT")).toEqual([0, 0])
    expect(alignFactors("LV_ALIGN_CENTER")).toEqual([0.5, 0.5])
    expect(alignFactors("LV_ALIGN_BOTTOM_RIGHT")).toEqual([1, 1])
    expect(alignFactors("LV_ALIGN_LEFT_MID")).toEqual([0, 0.5])
    expect(alignFactors("LV_ALIGN_TOP_MID")).toEqual([0.5, 0])
  })

  it("keeps the opposite edge put when resizing", () => {
    const start = { x: 0, y: 0, w: 100, h: 50 }
    expect(resizeLayout(start, "LV_ALIGN_TOP_LEFT", "e", 20, 0)).toEqual({ x: 0, y: 0, w: 120, h: 50 })
    expect(resizeLayout(start, "LV_ALIGN_TOP_LEFT", "w", 20, 0)).toEqual({ x: 20, y: 0, w: 80, h: 50 })
    // centred: growing 20 to the right means the centre moves 10
    expect(resizeLayout(start, "LV_ALIGN_CENTER", "e", 20, 0)).toEqual({ x: 10, y: 0, w: 120, h: 50 })
    expect(resizeLayout(start, "LV_ALIGN_BOTTOM_RIGHT", "n", 0, -10)).toEqual({ x: 0, y: 0, w: 100, h: 60 })
    expect(resizeLayout(start, "LV_ALIGN_TOP_LEFT", "w", 500, 0).w).toBe(1)
  })

  it("snaps to the nearest edge or centre", () => {
    const parent = { x: 0, y: 0, w: 240, h: 240 }
    const r = snapMove({ x: 10, y: 10, w: 40, h: 40 }, [parent], 88, 3, 4)
    expect(r.dx).toBe(90) // centre 30+88=118 snaps to the parent's centre at 120
    expect(r.dy).toBe(3) // edges at 13/33/53 are nowhere near 0/120/240
    expect(r.guides).toEqual([{ axis: "x", at: 120 }])
  })

  it("finds the insertion index in a flex row", () => {
    const parent = createNode("container", { layout: { x: 0, y: 0, w: 300, h: 40, align: "LV_ALIGN_TOP_LEFT", flex: { flow: "LV_FLEX_FLOW_ROW", main: "", cross: "", track: "" } } })
    const [a, b, c] = ["a", "b", "c"].map(name => createNode("label", { name }))
    parent.children = [a, b, c]
    const rects: Rects = new Map([
      [a.id, { x: 0, y: 0, w: 50, h: 20 }],
      [b.id, { x: 60, y: 0, w: 50, h: 20 }],
      [c.id, { x: 120, y: 0, w: 50, h: 20 }],
    ])
    expect(flexIndex(parent, rects, a.id, 100, 10)).toBe(2)
    expect(flexIndex(parent, rects, c.id, 5, 10)).toBe(0)
  })
})
