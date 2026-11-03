import { expect, it } from "vitest"
import { editorApi } from "@/entities/editor"
import {
  compile,
  createEmptyProject,
  createNode,
  createScreen,
  findNode,
  projectApi,
} from "@/entities/project"
import { alignSelection, distributeSelection, navigateOnClick } from "./actions"

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

it("wires a click to open a screen, like a prototype noodle, and retargets it", () => {
  const p = createEmptyProject()
  const away = createScreen("Away", p.target.display, { x: 400, y: 0 })
  const back = createScreen("Back", p.target.display, { x: -400, y: 0 })
  p.screens.push(away, back)
  const label = createNode("label", { name: "go" })
  p.screens[0].children = [label]
  projectApi.getState().replace(p)
  const events = () => findNode(projectApi.getState().project, label.id)!.events
  navigateOnClick(label.id, away.id)
  expect(events()).toMatchObject([
    {
      trigger: "LV_EVENT_CLICKED",
      action: { type: "navigate", screen: away.id, anim: "LV_SCREEN_LOAD_ANIM_MOVE_LEFT" },
    },
  ])
  navigateOnClick(label.id, back.id)
  expect(events()).toHaveLength(1)
  expect(events()[0].action).toMatchObject({ screen: back.id })
  // a label doesn't take clicks in LVGL; one with a click interaction does once built
  const ops = compile(projectApi.getState().project, "play").screens[0].ops
  const clickable = ops.find(op => op.op === "call" && op.fn === "lv_obj_set_clickable")
  expect(clickable).toMatchObject({
    args: [
      { k: "obj", id: label.id },
      { k: "bool", v: true },
    ],
  })
})
