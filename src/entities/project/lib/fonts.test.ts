import { existsSync, readFileSync } from "node:fs"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { LvglRuntime, Scene, parseTtfFont, ttfFont } from "@/shared/lvgl"
import { createEmptyProject, createNode, newId } from "../model/factory"
import type { Project } from "../model/types"
import { compile } from "./compile"
import { ttfUses } from "./fonts"
import { cNames } from "./names"

// LVGL's checkout (runtime/lvgl, cloned by the runtime build and by CI) carries Lato, under the OFL
const LATO_TTF = new URL("../../../../runtime/lvgl/examples/libs/freetype/Lato-Regular.ttf", import.meta.url)
const LATO = existsSync(LATO_TTF) ? readFileSync(LATO_TTF).toString("base64") : ""

let rt: LvglRuntime
beforeAll(async () => {
  rt = await LvglRuntime.load(readFileSync(new URL("../../../shared/lvgl/runtime/kiln-rt.wasm", import.meta.url)), () => {})
})

/** One screen of labels, one per font value; `font` gets the imported Lato's id. */
function project(fonts: ((lato: string) => string)[], data = LATO) {
  const p = createEmptyProject()
  const lato = { id: newId(), name: "Lato Regular", data }
  p.fonts.push(lato)
  p.screens[0].children = fonts.map((font, i) => createNode("label", { name: `l${i}`, props: { text: "Hello 42" }, style: { "main:default": { text_font: font(lato.id) } } }))
  return { p, lato }
}

/** Each label's laid-out box after running the edit-mode program on the wasm LVGL. */
function boxes(p: Project) {
  const program = compile(p, "edit")
  const setup = new Scene(rt)
  setup.run(program.setup)
  const display = rt.createDisplay(240, 240)
  display.makeDefault()
  const scene = new Scene(rt, setup)
  scene.run(program.screens[0].ops)
  rt.x.lv_screen_load(scene.screen())
  rt.tick(30)
  const out = p.screens[0].children.map(n => rt.coords(scene.get("obj", n.id)!))
  display.release()
  scene.dispose()
  setup.dispose()
  display.delete()
  return out
}

describe.runIf(LATO)("imported fonts", () => {
  it("are drawn by TinyTTF at the size a style asks for", () => {
    const { p } = project([id => ttfFont(id, 20), id => ttfFont(id, 40), () => "lv_font_montserrat_40"])
    const [small, big, montserrat] = boxes(p)
    expect(Math.abs(big.h - 2 * small.h)).toBeLessThanOrEqual(2)
    // same text and size, different typeface
    expect(big.w).not.toBe(montserrat.w)
  })

  it("become one TinyTTF font per size in use, with C names", () => {
    const { p, lato } = project([id => ttfFont(id, 24), id => ttfFont(id, 24), id => ttfFont(id, 999), () => "ttf:nope:24"])
    expect(ttfUses(p)).toEqual([{ id: lato.id, size: 24 }])
    const { setup } = compile(p, "export")
    expect(setup.filter(op => op.op === "ttf" || op.op === "tiny_ttf").map(op => op.op)).toEqual(["ttf", "tiny_ttf"])
    const names = cNames(p)
    expect([names[lato.id], names[`${lato.id}@24`]]).toEqual(["ui_ttf_lato_regular", "ui_font_lato_regular_24"])
    expect(parseTtfFont("lv_font_montserrat_14")).toBeNull()
  })

  it("fall back to the default font when the file isn't one TinyTTF reads", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { p } = project([id => ttfFont(id, 40), () => "lv_font_montserrat_14"], btoa("definitely not a font"))
    const [broken, fallback] = boxes(p)
    expect(broken.h).toBe(fallback.h)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
