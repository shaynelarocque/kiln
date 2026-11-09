import { expect, it } from "vitest"
import { routeFlows, type FlowInput } from "./flows"

// Michael's layout: Home with Game to its right and Settings under it, 240×240 screens
const screen = (id: string, x: number, y: number) => ({ id, box: { x, y, w: 240, h: 240 } })
const home = screen("home", 0, 0)
const game = screen("game", 300, 0)
const settings = screen("settings", 0, 300)
const flow = (
  id: string,
  from: typeof home,
  to: typeof home,
  widget: FlowInput["widget"],
): FlowInput => ({
  id,
  screen: from,
  target: to,
  widget: { ...widget, x: from.box.x + widget.x, y: from.box.y + widget.y },
})
const startButton = { x: 40, y: 100, w: 100, h: 40 }
const settingsButton = { x: 40, y: 50, w: 100, h: 40 }
const wholeScreen = { x: 0, y: 0, w: 240, h: 240 }
const byId = (flows: FlowInput[]) => new Map(routeFlows(flows).map(r => [r.id, r]))

it("goes straight across to a screen beside it", () => {
  const r = byId([flow("start", home, game, startButton)]).get("start")!
  expect(r.from).toEqual({ x: 140, y: 120 })
  expect(r.to).toEqual({ x: 300, y: 120 })
  expect(r.in).toEqual({ x: 1, y: 0 })
})

it("leaves leftwards for a screen on the left, instead of doubling back across its own", () => {
  const r = byId([flow("back", game, home, wholeScreen)]).get("back")!
  expect(r.out).toEqual({ x: -1, y: 0 })
  expect(r.from.x).toBe(300)
  expect(r.to.x).toBe(240)
})

it("keeps a pair going both ways between two screens a lane apart", () => {
  const r = byId([flow("start", home, game, startButton), flow("back", game, home, wholeScreen)])
  // rightwards above, leftwards below
  expect(r.get("start")!.to.y).toBeLessThan(r.get("back")!.to.y)
  expect(r.get("back")!.to.y - r.get("start")!.to.y).toBeGreaterThanOrEqual(12)
})

it("drops into the top of a screen below, and comes up into the bottom of one above", () => {
  const r = byId([
    flow("open", home, settings, settingsButton),
    flow("close", settings, home, wholeScreen),
  ])
  expect(r.get("open")!.to.y).toBe(300)
  expect(r.get("open")!.in).toEqual({ x: 0, y: 1 })
  expect(r.get("close")!.to.y).toBe(240)
  expect(r.get("close")!.in).toEqual({ x: 0, y: -1 })
})

it("spreads noodles landing on one side, in the order they come from, so they don't cross", () => {
  const r = byId([
    flow("upper", home, game, settingsButton),
    flow("lower", home, game, startButton),
    flow("same", home, game, startButton),
  ])
  const ys = ["upper", "lower", "same"].map(id => r.get(id)!.to.y)
  expect(ys[0]).toBeLessThan(ys[1])
  expect(ys[1]).toBeLessThan(ys[2])
  expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(12)
  // and all of them on Game's left edge
  for (const id of ["upper", "lower", "same"]) expect(r.get(id)!.to.x).toBe(300)
})

it("keeps a pair going both ways between stacked screens from crossing: down on the right", () => {
  // Pet's button and Test's back button, one above the other
  const pet = screen("pet", 0, 0)
  const test = screen("test", 0, 300)
  const r = byId([
    flow("blow", pet, test, { x: 70, y: 180, w: 80, h: 30 }),
    flow("back", test, pet, { x: 100, y: 190, w: 40, h: 40 }),
  ])
  const down = r.get("blow")!
  const up = r.get("back")!
  expect(down.in).toEqual({ x: 0, y: 1 })
  expect(up.in).toEqual({ x: 0, y: -1 })
  expect(down.to.x - up.to.x).toBeGreaterThanOrEqual(12)
})
