import { readFileSync } from "node:fs"
import { beforeAll, describe, expect, it } from "vitest"
import { ALIGN, BIND_FLAGS, BIND_STATES, EVENTS, FLEX_ALIGN, FLEX_FLOW, LvglRuntime, SCREEN_LOAD_ANIM, Scene, STYLE_PROPS, WIDGETS, stylePropConst, type Op } from "@/shared/lvgl"
import { createSampleProject } from "../model/factory"
import { compile, safeFormat } from "./compile"

let rt: LvglRuntime
const logs: string[] = []

beforeAll(async () => {
  const wasm = readFileSync(new URL("../../../shared/lvgl/runtime/kiln-rt.wasm", import.meta.url))
  rt = await LvglRuntime.load(wasm, msg => logs.push(msg))
})

const allOps = (mode: "edit" | "play" | "export") => {
  const p = compile(createSampleProject(), mode)
  return [...p.setup, ...p.screens.flatMap(s => s.ops), ...p.wiring]
}

const readText = (p: number) => {
  const u8 = new Uint8Array(rt.memory)
  let end = p
  while (u8[end]) end++
  return new TextDecoder().decode(u8.subarray(p, end))
}

describe("the preview runtime knows everything the compiler and catalog name", () => {
  it("exports every called function", () => {
    const fns = new Set(allOps("play").flatMap((op: Op) => (op.op === "call" || op.op === "create" ? [op.fn] : [])))
    for (const w of Object.values(WIDGETS)) for (const c of w.calls) fns.add(c.fn)
    const missing = [...fns].filter(fn => !rt.x[fn] && !rt.x[`kiln__${fn}`] && !/^lv_(obj_set_style|style_set)_/.test(fn))
    expect(missing).toEqual([])
  })

  it("resolves every constant", () => {
    const names = [
      ...[ALIGN, FLEX_FLOW, FLEX_ALIGN, EVENTS, SCREEN_LOAD_ANIM, BIND_FLAGS, BIND_STATES].flat().map(o => o.value),
      ...STYLE_PROPS.flatMap(p => [stylePropConst(p.name), ...(p.options ?? []).map(o => o.value)]),
      ...Object.values(WIDGETS).flatMap(w => w.props.flatMap(p => (p.options ?? []).map(o => o.value))),
    ]
    for (const name of names) expect(() => rt.const(name), name).not.toThrow()
  })
})

describe("compiling the sample project", () => {
  it("renders every screen in edit mode", () => {
    const program = compile(createSampleProject(), "edit")
    const setup = new Scene(rt)
    setup.run(program.setup)
    for (const screen of program.screens) {
      const display = rt.createDisplay(240, 240)
      display.setTheme({ primary: "#ff6a00", secondary: "#2196f3", dark: true })
      display.makeDefault()
      const scene = new Scene(rt, setup)
      scene.run(screen.ops)
      rt.x.lv_screen_load(scene.screen())
      rt.tick(30)
      const px = display.pixels()
      const colors = new Set<number>()
      for (let i = 0; i < px.length; i += 4 * 97) colors.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2])
      expect(colors.size, screen.id).toBeGreaterThan(3)
      scene.dispose()
      display.delete()
    }
    setup.dispose()
  })

  it("plays: bindings follow variables and buttons navigate", () => {
    const project = createSampleProject()
    const program = compile(project, "play")
    const display = rt.createDisplay(240, 240)
    display.setTheme(project.theme)
    display.makeDefault()
    const setup = new Scene(rt)
    setup.run(program.setup)
    const scene = new Scene(rt, setup)
    for (const s of program.screens) scene.run(s.ops)
    scene.run(program.wiring)
    rt.x.lv_screen_load(scene.screen(0))
    for (let t = 0; t < 1000; t += 33) rt.tick(33)

    const temperature = project.variables.find(v => v.name === "temperature")!
    rt.x.lv_subject_set_int(setup.get("subject", temperature.id)!, 30)
    const label = project.screens[0].children.find(n => n.name === "temperature")!
    expect(readText(rt.x.lv_label_get_text(scene.get("obj", label.id)!))).toBe("30°")

    const button = project.screens[0].children.find(n => n.name === "settings_button")!
    const box = rt.coords(scene.get("obj", button.id)!)
    display.pointer(box.x + box.w / 2, box.y + box.h / 2, true)
    rt.tick(50)
    display.pointer(box.x + box.w / 2, box.y + box.h / 2, false)
    for (let t = 0; t < 600; t += 33) rt.tick(33)
    expect(rt.x.lv_display_get_screen_active(display.ptr)).toBe(scene.screen(1))

    scene.dispose()
    setup.dispose()
    display.delete()
    expect(logs.filter(l => /error/i.test(l))).toEqual([])
  })
})

describe("safeFormat", () => {
  it("keeps one matching conversion and rejects the rest", () => {
    expect(safeFormat("%d °C", "int")).toBe("%d °C")
    expect(safeFormat("%3d%%", "int")).toBe("%3d%%")
    expect(safeFormat("%s", "int")).toBeNull()
    expect(safeFormat("%d/%d", "int")).toBeNull()
    expect(safeFormat("no spec", "string")).toBeNull()
    expect(safeFormat("Hi %s", "string")).toBe("Hi %s")
  })
})
