import { expect, it } from "vitest"
import { createEmptyProject, createNode, projectApi } from "@/entities/project"
import { multiModel } from "./use-inspector"

it("edits several layers together: what they share shows, what differs is mixed, one undo", () => {
  const p = createEmptyProject()
  const layer = (radius: number, h: number) =>
    createNode("label", {
      layout: { x: 0, y: 0, w: 100, h, align: "LV_ALIGN_CENTER" },
      style: { "main:default": { text_color: "#ff0000", radius } },
    })
  const [a, b] = [layer(4, 20), layer(8, 30)]
  p.screens[0].children = [a, b]
  projectApi.getState().replace(p)

  const m = multiModel([a, b])
  expect(m.widget).toBe("label")
  expect(m.w).toEqual({ value: 100, mixed: false })
  expect(m.h.mixed).toBe(true)
  expect(m.style).toEqual({ text_color: "#ff0000" })
  expect(m.mixedStyle).toEqual(["radius"])

  const radii = () =>
    projectApi.getState().doc.screens[0].children.map(n => n.style["main:default"]?.radius)
  m.setStyle("radius", 12)
  m.setLayout("h", 24)
  expect(radii()).toEqual([12, 12])
  expect(projectApi.getState().doc.screens[0].children.map(n => n.layout.h)).toEqual([24, 24])
  projectApi.getState().undo()
  expect(radii()).toEqual([12, 12])
  projectApi.getState().undo()
  expect(radii()).toEqual([4, 8])
})
