import { readFileSync } from "node:fs"
import { beforeEach, expect, it } from "vitest"
import { editorApi } from "@/entities/editor"
import { createSampleProject, findNode, projectApi, type Node } from "@/entities/project"
import { workspaceApi } from "@/features/project-file"
import { LvglRuntime } from "@/shared/lvgl"
import { callTool, setRenderRuntime, toolList } from "./tools"

const wasm = readFileSync(new URL("../../shared/lvgl/runtime/kiln-rt.wasm", import.meta.url))
setRenderRuntime(() => LvglRuntime.load(wasm, () => {}))

const project = () => projectApi.getState().project
const out = async (name: string, args: object = {}) => {
  const r = await callTool(name, args as Record<string, unknown>)
  const first = r.content[0]
  return { ...r, text: first.type === "text" ? first.text : "" }
}
const data = async (name: string, args: object = {}) => JSON.parse((await out(name, args)).text)

beforeEach(() => {
  projectApi.getState().replace(createSampleProject())
  workspaceApi.setState({ tabs: [], active: "tab", home: false })
})

it("lists every tool with a schema MCP clients can read", () => {
  const tools = toolList()
  expect(new Set(tools.map(t => t.name)).size).toBe(tools.length)
  for (const t of tools) {
    expect(t.inputSchema.type).toBe("object")
    expect(t.description.length).toBeGreaterThan(20)
  }
})

it("says so when no project is open", async () => {
  workspaceApi.setState({ active: null })
  const r = await out("get_project")
  expect(r.isError).toBe(true)
  expect(r.text).toMatch(/No project is open/)
})

it("adds a widget, changes it and deletes it, one undo step each", async () => {
  const before = project()
  const home = before.screens[0]
  const { id } = await data("add_widget", {
    type: "label",
    parent: home.name,
    name: "reading",
    text: "21 °C",
    x: 10,
    y: 20,
    style: { "main:default": { text_color: "#ff8800", text_font: "lv_font_montserrat_20" } },
  })
  const label = findNode(project(), id)!
  expect(label.props.text).toBe("21 °C")
  expect([label.layout.x, label.layout.y]).toEqual([10, 20])
  expect(label.style["main:default"].text_color).toBe("#ff8800")
  expect(editorApi.getState().selection).toEqual([id])

  await out("update_layer", {
    layer: "reading",
    w: "content",
    style: { "main:default": { text_color: null } },
  })
  expect(findNode(project(), id)!.layout.w).toBe("content")
  expect(findNode(project(), id)!.style["main:default"]).toEqual({
    text_font: "lv_font_montserrat_20",
  })

  // each call is its own undo step
  projectApi.getState().undo()
  expect(findNode(project(), id)!.style["main:default"].text_color).toBe("#ff8800")
  projectApi.getState().undo()
  expect(findNode(project(), id)).toBeUndefined()
  expect(project()).toBe(before)
})

it("puts a button's text on the label inside it", async () => {
  const { id } = await data("add_widget", { type: "button", text: "Start" })
  const button = findNode(project(), id)!
  expect(button.children.find((c: Node) => c.widget === "label")!.props.text).toBe("Start")
})

it("turns away bad arguments with something the model can fix", async () => {
  const bad = (args: object) => out("add_widget", { type: "label", ...args })
  expect((await bad({ style: { "main:default": { colour: "#fff" } } })).text).toMatch(
    /no style property "colour"/,
  )
  expect((await bad({ style: { "body:default": { bg_color: "#fff" } } })).text).toMatch(
    /isn't a selector/,
  )
  expect((await bad({ props: { nope: 1 } })).text).toMatch(/has no prop "nope"/)
  expect((await bad({ x: "left" })).text).toMatch(/pixels, a percentage/)
  expect((await out("add_widget", { type: "teapot" })).isError).toBe(true)
  expect((await out("update_layer", { layer: "ghost" })).text).toMatch(/no layer "ghost"/)
})

it("wires a variable, a binding and a navigation", async () => {
  const { id: screen } = await data("add_screen", { name: "Details" })
  const { id: v } = await data("add_variable", { name: "humidity", min: 0, max: 100, initial: 40 })
  const { id: label } = await data("add_widget", { type: "label" })
  await out("add_binding", { layer: label, kind: "text", variable: "humidity", format: "%d %%" })
  await out("add_interaction", { layer: label, action: { type: "navigate", screen: "Details" } })
  const node = findNode(project(), label)!
  expect(node.bindings).toEqual([{ kind: "text", variable: v, format: "%d %%" }])
  expect(node.events[0].action).toMatchObject({ type: "navigate", screen })
  // a value binding needs a widget that has a value
  expect((await out("add_binding", { layer: label, kind: "value", variable: v })).text).toMatch(
    /doesn't take a value binding/,
  )
})

it("describes a screen's layers", async () => {
  const screen = await data("get_screen")
  expect(screen.widget).toBe("screen")
  expect(screen.children.length).toBeGreaterThan(0)
  const overview = await data("get_project")
  expect(overview.screens[0].start).toBe(true)
  expect(overview.display.round).toBe(true)
})

it("draws a screen with LVGL, round like the panel", async () => {
  const r = await callTool("render_screen")
  expect(r.isError).toBeUndefined()
  const [image, caption] = r.content
  expect(image).toMatchObject({ type: "image", mimeType: "image/png" })
  const png = Buffer.from(image.type === "image" ? image.data : "", "base64")
  expect([...png.subarray(1, 4)].map(c => String.fromCharCode(c)).join("")).toBe("PNG")
  // where each layer landed comes along, in display pixels
  const first = project().screens[0].children[0]
  expect(caption.type === "text" && caption.text).toContain(`${first.name} (`)
})

it("needs the desktop app to build", async () => {
  const r = await out("build")
  expect(r.isError).toBe(true)
  expect(r.text).toMatch(/desktop app/)
})
