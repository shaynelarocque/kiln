import { expect, it } from "vitest"
import { editorApi } from "@/entities/editor"
import { createEmptyProject, createNode, findNode, projectApi } from "@/entities/project"
import { alignSelection, distributeSelection } from "./actions"

/** Three 20×10 buttons at x 10, 50, 100, with the boxes the preview would publish. */
function setup() {
  const p = createEmptyProject()
  const screen = p.screens[0]
  screen.children = [10, 50, 100].map((x, i) =>
    createNode("button", {
      name: `b${i}`,
      layout: { x, y: i * 10, w: 20, h: 10, align: "LV_ALIGN_TOP_LEFT" },
    }),
  )
  projectApi.getState().replace(p)
  const boxes = new Map(
    screen.children.map(n => [
      n.id,
      { x: n.layout.x as number, y: n.layout.y as number, w: 20, h: 10 },
    ]),
  )
  editorApi.getState().set({ rects: new Map([[screen.id, boxes]]) })
  const ids = screen.children.map(n => n.id)
  const layout = () => ids.map(id => findNode(projectApi.getState().project, id)!.layout)
  return { ids, layout }
}

it("aligns several layers by their boxes", () => {
  const { ids, layout } = setup()
  editorApi.getState().select(ids)
  alignSelection("right")
  expect(layout().map(l => l.x)).toEqual([100, 100, 100])
  expect(layout().map(l => l.y)).toEqual([0, 10, 20])
})

it("aligns one layer in its parent through its LVGL align", () => {
  const { ids, layout } = setup()
  editorApi.getState().select([ids[1]])
  alignSelection("vcenter")
  expect(layout()[1]).toMatchObject({ align: "LV_ALIGN_LEFT_MID", x: 50, y: 0 })
  alignSelection("right")
  expect(layout()[1]).toMatchObject({ align: "LV_ALIGN_RIGHT_MID", x: 0, y: 0 })
})

it("distributes three or more, keeping the outer two", () => {
  const { ids, layout } = setup()
  editorApi.getState().select(ids.slice(0, 2))
  distributeSelection("x")
  expect(layout().map(l => l.x)).toEqual([10, 50, 100])
  // 10..120 holds 60 px of buttons, leaving two 25 px gaps
  editorApi.getState().select(ids)
  distributeSelection("x")
  expect(layout().map(l => l.x)).toEqual([10, 55, 100])
})
