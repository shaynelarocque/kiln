import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { BUNDLED_BOARDS, findBoard } from "@/entities/board"
import { compile, createAnimation, createEmptyProject, createInstance, createNode, createScreen, createVariable, makeComponent, newId, type Project } from "@/entities/project"
import { generateFirmware } from "@/features/export-firmware"
import { convert } from "@/features/import-image"
import { toBase64 } from "@/shared/lib/base64"
import { ANIM_PROPS, INSERTABLE, LvglRuntime, Scene, ttfFont } from "@/shared/lvgl"

const lvgl = new URL("../../runtime/lvgl", import.meta.url).pathname
// LVGL's checkout carries Lato (OFL): the imported-font case needs it
const lato = join(lvgl, "examples/libs/freetype/Lato-Regular.ttf")

/** One of everything: every widget, binding, action, animated property and asset kind. */
function kitchenSink(): Project {
  const p = createEmptyProject("Kitchen sink")
  const [home] = p.screens
  const other = createScreen("Other", p.target.display, { x: 400, y: 0 })
  p.screens.push(other)

  const level = createVariable("level", { initial: 40 })
  const on = createVariable("on", { initial: 1, max: 1 })
  const label = createVariable("label", { type: "string", initial: "hello" })
  p.variables.push(level, on, label)
  const accent = { id: newId(), name: "accent", value: "#ff00ff" }
  p.tokens.push(accent)
  const card = { id: newId(), name: "card", props: { bg_color: `$${accent.id}`, radius: 8, text_font: "lv_font_montserrat_20" } }
  p.styles.push(card)

  const { data, stride } = convert(new Uint8Array(16 * 4).fill(200), 4, 4, "RGB565A8", true)
  const asset = { id: newId(), name: "dot", width: 4, height: 4, format: "RGB565A8" as const, dither: true, png: "", data: toBase64(data), stride }
  p.assets.push(asset)

  const nodes = INSERTABLE.map(type => createNode(type, { name: `a_${type}` }))
  const byType = Object.fromEntries(nodes.map(n => [n.widget, n]))
  byType.image.props.src = asset.id
  byType.container.layout.flex = { flow: "LV_FLEX_FLOW_ROW_WRAP", main: "LV_FLEX_ALIGN_SPACE_BETWEEN", cross: "LV_FLEX_ALIGN_CENTER", track: "LV_FLEX_ALIGN_START" }
  byType.container.children = [createNode("label", { name: "in_flex", layout: { x: 0, y: 0, w: "50%", h: "content", align: "LV_ALIGN_TOP_LEFT", grow: 1 } })]
  byType.container.classes = [{ style: card.id, selector: "main:default" }]
  byType.button.checkable = true
  byType.button.style = { "main:checked+pressed": { bg_color: "#00ff00", transform_rotation: 150 }, "main:pressed": { transform_scale_x: 300 } }
  byType.button.transition = { props: ["bg_color", "transform_scale_x"], duration: 120, delay: 10, easing: "ease-in-out" }
  byType.label.bindings = [{ kind: "text", variable: label.id, format: "Hi %s" }]
  for (const t of ["arc", "bar", "slider", "roller", "dropdown"]) byType[t].bindings = [{ kind: "value", variable: level.id }]
  byType.switch.bindings = [{ kind: "checked", variable: on.id }]
  byType.checkbox.bindings = [{ kind: "checked", variable: on.id }]
  byType.chart.bindings = [{ kind: "series", variable: level.id }]
  byType.led.bindings = [
    { kind: "flag", variable: on.id, flag: "LV_OBJ_FLAG_HIDDEN", compare: "eq", ref: 0 },
    { kind: "state", variable: level.id, state: "LV_STATE_DISABLED", compare: "gt", ref: 90 },
    { kind: "style", variable: level.id, prop: "opa", selector: "main:default", inMin: 0, inMax: 100, outMin: 0, outMax: 255 },
    { kind: "style", variable: level.id, prop: "translate_x", selector: "main:default", inMin: 0, inMax: 100, outMin: 0, outMax: 100 },
  ]

  const anim = { ...createAnimation("everything"), repeat: -1, alternate: true, delay: 50, autoplay: true }
  for (const prop of ANIM_PROPS) {
    const target = prop.widgets ? byType[prop.widgets[0]] : byType.label
    const [from, to] = prop.unit === "color" ? ["#000000", "#ffffff"] : [0, 50]
    anim.tracks.push({ id: newId(), node: target.id, prop: prop.value, keyframes: [{ t: 0, value: from, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }, { t: 300, value: to, easing: "bounce" }, { t: 500, value: from, easing: "linear" }] })
  }
  p.animations.push(anim)

  byType.button.events = [
    { id: newId(), trigger: "LV_EVENT_CLICKED", action: { type: "navigate", screen: other.id, anim: "LV_SCREEN_LOAD_ANIM_FADE_IN", duration: 200, delay: 0 } },
    { id: newId(), trigger: "LV_EVENT_PRESSED", action: { type: "set", variable: level.id, value: 7 } },
    { id: newId(), trigger: "LV_EVENT_LONG_PRESSED", action: { type: "increment", variable: level.id, step: -5 } },
    { id: newId(), trigger: "LV_EVENT_RELEASED", action: { type: "toggle", variable: on.id } },
    { id: newId(), trigger: "LV_EVENT_VALUE_CHANGED", action: { type: "play", animation: anim.id, reverse: true, delay: 5 } },
  ]
  home.children = nodes
  other.children = [createNode("label", { name: "other_label" })]

  // a component with two instances, one overriding a text and a binding's variable
  const tile = createNode("container", { name: "tile" })
  const caption = createNode("label", { name: "caption", props: { text: "Level", longMode: "LV_LABEL_LONG_MODE_WRAP" } })
  const reading = createNode("label", { name: "reading", bindings: [{ kind: "text", variable: level.id, format: "%d%%" }] })
  tile.children = [caption, reading]
  other.children.push(tile)
  makeComponent(p, tile.id)
  const second = createInstance(p, tile.id, "tile_2")!
  second.overrides = { [caption.id]: { props: { text: "Switch" } }, [reading.id]: { variable: on.id } }
  other.children.push(second)
  // a timeline on a layer of the main runs in both instances
  p.animations.push({ ...createAnimation("blink"), tracks: [{ id: newId(), node: reading.id, prop: "opa", keyframes: [{ t: 0, value: 255, easing: "linear" }, { t: 300, value: 80, easing: "ease-out" }] }] })

  // an imported font at two sizes: on a widget, and through a shared style
  if (existsSync(lato)) {
    const font = { id: newId(), name: "Lato", data: readFileSync(lato).toString("base64") }
    p.fonts.push(font)
    other.children[0].style = { "main:default": { text_font: ttfFont(font.id, 30) } }
    const small = { id: newId(), name: "small_print", props: { text_font: ttfFont(font.id, 12) } }
    p.styles.push(small)
    caption.classes = [{ style: small.id, selector: "main:default" }]
  }
  return p
}

describe("a project that uses everything", () => {
  it("plays on the wasm LVGL without errors", async () => {
    const logs: string[] = []
    const rt = await LvglRuntime.load(readFileSync(new URL("../shared/lvgl/runtime/kiln-rt.wasm", import.meta.url)), m => logs.push(m))
    const project = kitchenSink()
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
    for (let t = 0; t < 1500; t += 33) rt.tick(33)
    rt.x.lv_subject_set_int(setup.get("subject", project.variables[0].id)!, 95)
    rt.tick(33)
    display.release()
    scene.dispose()
    setup.dispose()
    display.delete()
    expect(logs.filter(l => /error|assert/i.test(l))).toEqual([])
  })

  it.runIf(existsSync(lvgl))("exports C that compiles against LVGL 9.6", () => {
    const project = kitchenSink()
    const files = generateFirmware(project, findBoard(BUNDLED_BOARDS, project.target.board))
    // KILN_SINK_DIR keeps the export somewhere known, for a real `pio run`
    const dir = process.env.KILN_SINK_DIR ?? mkdtempSync(join(tmpdir(), "kiln-sink-"))
    for (const f of files) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true })
      writeFileSync(join(dir, f.path), f.content)
    }
    for (const f of files.filter(f => /^src\/ui\/.*\.c$/.test(f.path)))
      execFileSync("cc", ["-fsyntax-only", "-std=c11", "-Wall", "-Werror=implicit-function-declaration", "-Werror=incompatible-pointer-types", "-Werror=int-conversion", "-Werror=deprecated-declarations", "-Wno-unused-variable", "-DLV_CONF_INCLUDE_SIMPLE", `-I${dir}/include`, `-I${lvgl}`, join(dir, f.path)], { stdio: "pipe" })
    expect(files.find(f => f.path === "src/ui/ui_images.c")!.content).toContain(".cf = LV_COLOR_FORMAT_RGB565A8")
    expect(files.find(f => f.path === "src/ui/ui_fonts.c")!.content).toMatch(/^LV_ATTRIBUTE_LARGE_CONST const uint8_t ui_ttf_lato\[\d+\] = \{$/m)
    expect(files.find(f => f.path === "include/lv_conf.h")!.content).toContain("#define LV_USE_TINY_TTF 1")
    const ui = files.find(f => f.path === "src/ui/ui.c")!.content
    expect(ui).toContain("ui_font_lato_30 = lv_tiny_ttf_create_data_ex(ui_ttf_lato, sizeof(ui_ttf_lato), 30, LV_FONT_KERNING_NORMAL, 48);")
    expect(ui).toContain("lv_style_set_text_font(&ui_style_small_print, ui_font_lato_12);")
    // the Components screen isn't exported, but both instances are, as plain widgets
    expect(files.some(f => f.path === "src/ui/ui_components.c")).toBe(false)
    const other = files.find(f => f.path === "src/ui/ui_other.c")!.content
    expect(other).toContain('lv_label_set_text(ui_caption_2, "Switch");')
    expect(other).toContain("lv_label_bind_text(ui_reading_2, ui_var_on,")
    const wire = files.find(f => f.path === "src/ui/ui.c")!.content
    expect(wire).toContain("lv_anim_set_var(&a, ui_reading);")
    expect(wire).toContain("lv_anim_set_var(&a, ui_reading_2);")
  })
})
