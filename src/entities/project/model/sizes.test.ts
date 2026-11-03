import { expect, it } from "vitest"
import { createEmptyProject, createNode } from "./factory"
import { locate } from "./mutations"
import { edit, projectApi } from "./store"

/** A 240×240 project with one button, plus a 160×128 size, opened at the base. */
function setup() {
  const p = createEmptyProject()
  const button = createNode("button", {
    name: "go",
    layout: { x: 10, y: 20, w: 100, h: 40, align: "LV_ALIGN_CENTER" },
    style: { "main:default": { radius: 8 } },
  })
  p.screens[0].children = [button]
  p.screens[0].frame = { x: 300, y: 0 }
  const display = { ...p.target.display, width: 160, height: 128, round: false }
  p.sizes.push({ id: "small", name: "160×128", target: { ...p.target, display } })
  projectApi.getState().replace(p)
  return { id: button.id, screen: p.screens[0].id }
}
const docNode = (id: string) => locate(projectApi.getState().doc, id)!.node
const viewNode = (id: string) => locate(projectApi.getState().project, id)!.node

it("shows the document at a size: its display, with screens filling it and spaced to match", () => {
  setup()
  projectApi.getState().setSize("small")
  const { project } = projectApi.getState()
  expect(project.target.display.width).toBe(160)
  expect(project.screens[0].layout).toMatchObject({ w: 160, h: 128 })
  expect(project.screens[0].frame).toEqual({ x: 200, y: 0 })
})

it("keeps layout and style edits made at a size to that size", () => {
  const { id } = setup()
  projectApi.getState().setSize("small")
  edit(d => {
    const n = locate(d, id)!.node
    n.layout.w = 80
    n.style["main:default"].radius = 4
  })
  expect(viewNode(id).layout.w).toBe(80)
  expect(docNode(id).layout.w).toBe(100)
  expect(docNode(id).at).toEqual({
    small: { layout: { w: 80 }, style: { "main:default": { radius: 4 } } },
  })
  projectApi.getState().setSize(null)
  expect(viewNode(id).layout.w).toBe(100)
  // setting the base values back drops the patch
  projectApi.getState().setSize("small")
  edit(d => {
    const n = locate(d, id)!.node
    n.layout.w = 100
    n.style["main:default"].radius = 8
  })
  expect(docNode(id).at).toBeUndefined()
})

it("shares everything else: names, new layers and the base, but not the board it's built for", () => {
  const { id, screen } = setup()
  projectApi.getState().setSize("small")
  edit(d => {
    const n = locate(d, id)!.node
    n.name = "start"
    delete n.style["main:default"].radius
  })
  edit(d => void locate(d, screen)!.node.children.push(createNode("label", { name: "hint" })))
  edit(d => void (d.target.display.bufferRows = 16))
  const { doc } = projectApi.getState()
  expect(docNode(id).name).toBe("start")
  // a prop removed at a size is null in its patch, and gone from the view
  expect(docNode(id).at?.small?.style).toEqual({ "main:default": { radius: null } })
  expect(viewNode(id).style["main:default"]).toBeUndefined()
  expect(doc.screens[0].children.map(n => n.name)).toEqual(["start", "hint"])
  expect(doc.target.display.bufferRows).not.toBe(16)
  expect(doc.sizes[0].target.display.bufferRows).toBe(16)
  // undo walks back through the document
  projectApi.getState().undo()
  expect(projectApi.getState().doc.sizes[0].target.display.bufferRows).not.toBe(16)
  expect(projectApi.getState().project.target.display.width).toBe(160)
})
