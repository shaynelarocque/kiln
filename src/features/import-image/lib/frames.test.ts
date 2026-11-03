import { expect, it } from "vitest"
import { byNumberedName, stripFrames } from "./frames"

it("splits strips of square frames, either way, and leaves other images whole", () => {
  expect(stripFrames(128, 32)).toEqual({ count: 4, size: 32, across: true })
  expect(stripFrames(16, 96)).toEqual({ count: 6, size: 16, across: false })
  expect(stripFrames(100, 30).count).toBe(1)
  expect(stripFrames(32, 32).count).toBe(1)
})

it("orders numbered frames by their numbers", () => {
  const names = ["walk10.png", "walk2.png", "walk1.png"].map(name => ({ name }))
  expect(byNumberedName(names).map(f => f.name)).toEqual(["walk1.png", "walk2.png", "walk10.png"])
})
