import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { transformLayerBytes } from "@/entities/board"
import {
  compile,
  createEmptyProject,
  createNode,
  transformedNodes,
  type Project,
  type StyleProps,
} from "@/entities/project"
import { largestLayer } from "@/features/export-firmware"
import { LvglRuntime, Scene } from "@/shared/lvgl"

const wasm = readFileSync(new URL("../shared/lvgl/runtime/kiln-rt.wasm", import.meta.url))

/** A 200×120 card in the middle of the screen, styled with `style`. */
function card(style: StyleProps): Project {
  const p = createEmptyProject()
  p.screens[0].children = [
    createNode("container", {
      name: "card",
      layout: { x: 0, y: 0, w: 200, h: 120, align: "LV_ALIGN_CENTER" },
      style: { "main:default": style },
    }),
  ]
  return p
}

/** LVGL's peak heap use after drawing a project's first screen, on a runtime of its own. */
async function peakHeap(p: Project) {
  const rt = await LvglRuntime.load(wasm, () => {})
  const monitor = rt.x.lv_malloc(32)
  const program = compile(p, "edit")
  const display = rt.createDisplay(240, 240)
  display.makeDefault()
  const setup = new Scene(rt)
  setup.run(program.setup)
  const scene = new Scene(rt, setup)
  scene.run(program.screens[0].ops)
  rt.x.lv_screen_load(scene.screen())
  rt.tick(30)
  rt.x.lv_mem_monitor(monitor)
  return new DataView(rt.memory).getUint32(monitor + 20, true) // lv_mem_monitor_t.max_used
}

describe("transform layers", () => {
  it("cost what the budget says: LVGL draws a rotated widget whole, at 4 bytes a pixel", async () => {
    const flat = await peakHeap(card({}))
    const rotated = card({ transform_rotation: 450, transform_pivot_x: 100, transform_pivot_y: 60 })
    const extra = (await peakHeap(rotated)) - flat
    const [t] = [...transformedNodes(rotated).values()]
    const estimate = transformLayerBytes(200, 120, t, 24)
    expect(estimate).toBe(210 * 130 * 4)
    // the estimate is the layer itself; the rest is LVGL's own bookkeeping for drawing it
    expect(extra).toBeGreaterThan(estimate * 0.9)
    expect(extra).toBeLessThan(estimate * 1.2)
  })

  it("know which widgets get one: rotated or scaled in any state, by a class, or by an animation", () => {
    const p = createEmptyProject()
    const pressed = createNode("button", {
      name: "pressed",
      style: { "main:pressed": { transform_scale_x: 240 } },
    })
    const classed = createNode("button", {
      name: "classed",
      classes: [{ style: "pop", selector: "main:default" }],
    })
    const spun = createNode("label", { name: "spun" })
    const still = createNode("label", {
      name: "still",
      style: { "main:default": { shadow_width: 8 } },
    })
    p.screens[0].children = [pressed, classed, spun, still]
    p.styles.push({ id: "pop", name: "pop", props: { transform_scale_y: 300 } })
    p.animations.push({
      id: "a",
      name: "spin",
      tracks: [
        {
          id: "t",
          node: spun.id,
          prop: "rotation",
          keyframes: [
            { t: 0, value: 0, easing: "linear" },
            { t: 500, value: 3600, easing: "linear" },
          ],
        },
      ],
      repeat: -1,
      alternate: false,
      delay: 0,
      autoplay: true,
    })
    const t = transformedNodes(p)
    expect([...t.keys()]).toEqual([pressed.id, classed.id, spun.id])
    expect(t.get(pressed.id)).toMatchObject({ rotates: false, minScale: 240 })
    expect(t.get(spun.id)!.rotates).toBe(true)
    // scaled only: one refresh band's worth of rows (24 rows, at 240/256 scale → 26), not the whole widget
    expect(transformLayerBytes(100, 200, t.get(pressed.id)!, 24)).toBe(110 * (26 + 10) * 4)
  })

  it("guess a label's box from its text when there's no preview to measure it", () => {
    const p = createEmptyProject()
    p.screens[0].children = [
      createNode("label", {
        name: "spin",
        props: { text: "hello", longMode: "LV_LABEL_LONG_MODE_WRAP" },
        layout: { x: 0, y: 0, w: "content", h: "content", align: "LV_ALIGN_CENTER" },
        style: { "main:default": { text_font: "lv_font_montserrat_20", transform_rotation: 100 } },
      }),
    ]
    // 5 characters of 20 px type: about 60 × 24, padded 5 px a side, 4 bytes a pixel
    expect(largestLayer(p)).toEqual({ name: "spin", bytes: (60 + 10) * (24 + 10) * 4 })
  })
})
