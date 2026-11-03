import { expect, it } from "vitest"
import { createEmptyProject, createNode, createScreen, createVariable } from "../model/factory"
import { cNames } from "./names"

it("never hands out a name the generated code already uses, or derives", () => {
  const p = createEmptyProject()
  p.screens.push(createScreen("Setup", p.target.display), createScreen("Init", p.target.display))
  p.screens[0].children.push(createNode("label", { name: "home create" }))
  const x = createVariable("x", { type: "string" })
  const xBuf = createVariable("x buf")
  p.variables.push(x, xBuf)
  const names = cNames(p)
  const all = Object.values(names)
  expect(all).not.toContain("ui_setup")
  expect(all).not.toContain("ui_init")
  // "Home" makes ui_home_create(); a label can't take that name
  expect(names[p.screens[0].children[0].id]).not.toBe("ui_home_create")
  // x's string buffer is ui_var_x_buf, so "x buf" gets something else
  expect(names[xBuf.id]).not.toBe("ui_var_x_buf")
  expect(new Set(all).size).toBe(all.length)
})
