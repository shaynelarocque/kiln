import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import {
  compile,
  createEmptyProject,
  createNode,
  createScreen,
  createVariable,
  DEFAULT_DISPLAY,
} from "@/entities/project"
import { LvglRuntime, Scene } from "@/shared/lvgl"

const wasm = readFileSync(new URL("../shared/lvgl/runtime/kiln-rt.wasm", import.meta.url))

/** Two screens, worked with buttons alone: Feed and Play bump counters, Play also opens a second screen. */
function buttonsProject() {
  const project = createEmptyProject("Buttons")
  const fed = createVariable("fed")
  const played = createVariable("played")
  project.variables = [fed, played]
  const home = project.screens[0]
  const away = createScreen("Away", DEFAULT_DISPLAY, { x: 300, y: 0 })
  const toggle = createNode("switch", { name: "toggle" })
  away.children = [toggle]
  const label = createNode("label", { name: "title" })
  const feed = createNode("button", {
    name: "feed",
    events: [
      {
        id: "e1",
        trigger: "LV_EVENT_CLICKED",
        action: { type: "increment", variable: fed.id, step: 1 },
      },
    ],
  })
  const play = createNode("button", {
    name: "play",
    layout: { x: 0, y: 60, w: 100, h: 40, align: "LV_ALIGN_TOP_LEFT" },
    events: [
      {
        id: "e2",
        trigger: "LV_EVENT_CLICKED",
        action: { type: "increment", variable: played.id, step: 1 },
      },
      {
        id: "e3",
        trigger: "LV_EVENT_CLICKED",
        action: {
          type: "navigate",
          screen: away.id,
          anim: "LV_SCREEN_LOAD_ANIM_FADE_IN",
          duration: 200,
          delay: 0,
        },
      },
    ],
  })
  home.children = [label, feed, play]
  project.screens.push(away)
  project.target.buttons = [
    { id: "b1", name: "Next", pin: 8, activeLow: true, key: "next" },
    { id: "b2", name: "Select", pin: 9, activeLow: true, key: "enter" },
  ]
  return { project, fed, played, toggle }
}

it("works a UI with buttons alone: Next moves the focus, Enter presses, and focus follows screens", async () => {
  const logs: string[] = []
  const rt = await LvglRuntime.load(wasm, m => logs.push(m))
  const { project, fed, played, toggle } = buttonsProject()
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

  const value = (id: string) => rt.x.lv_subject_get_int(setup.get("subject", id)!)
  const press = (key: string) => {
    display.key(key, true)
    rt.tick(30)
    display.key(key, false)
    rt.tick(30)
  }

  // the label takes no focus, so the first button has it
  press("LV_KEY_ENTER")
  expect([value(fed.id), value(played.id)]).toEqual([1, 0])
  press("LV_KEY_NEXT")
  press("LV_KEY_ENTER")
  expect([value(fed.id), value(played.id)]).toEqual([1, 1])

  // Play opened the second screen; once it's in, Enter reaches its switch
  for (let t = 0; t < 400; t += 20) rt.tick(20)
  expect(rt.x.lv_screen_active()).toBe(scene.screen(1))
  const checked = () =>
    Boolean(rt.x.lv_obj_has_state(scene.get("obj", toggle.id)!, rt.const("LV_STATE_CHECKED")))
  expect(checked()).toBe(false)
  press("LV_KEY_ENTER")
  expect(checked()).toBe(true)

  display.release()
  scene.dispose()
  setup.dispose()
  display.delete()
  expect(logs.filter(l => /error|assert/i.test(l))).toEqual([])
})

it("adds nothing for boards without buttons", () => {
  const { project } = buttonsProject()
  project.target.buttons = []
  const ops = JSON.stringify(compile(project, "export").wiring)
  expect(ops).not.toContain("kiln_focus_add")
})
