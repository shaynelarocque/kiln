import { expect, it } from "vitest"
import { alignMoves, distributeMoves } from "./align"

const boxes = [
  { x: 10, y: 0, w: 20, h: 10 },
  { x: 50, y: 30, w: 40, h: 20 },
  { x: 100, y: 5, w: 10, h: 10 },
]

it("aligns boxes to the selection's edges and centres", () => {
  expect(alignMoves(boxes, "left").map(m => m.dx)).toEqual([0, -40, -90])
  expect(alignMoves(boxes, "right").map(m => m.dx)).toEqual([80, 20, 0])
  // the selection spans 10..110, so its centre is 60
  expect(alignMoves(boxes, "hcenter").map(m => m.dx)).toEqual([40, -10, -45])
  expect(alignMoves(boxes, "bottom").map(m => m.dy)).toEqual([40, 0, 35])
})

it("spaces boxes evenly, keeping the ends", () => {
  // span 10..110 holds 70 px of boxes, so the two gaps are 15 each
  const moves = distributeMoves(boxes, "x")
  expect(moves[0].dx).toBe(0)
  expect(boxes[1].x + moves[1].dx).toBe(45)
  expect(moves[2].dx).toBe(0)
})
