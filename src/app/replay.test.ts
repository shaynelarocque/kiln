import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { allNodes, createSampleProject, ProjectPlayer, renderScreen } from "@/entities/project"
import { LvglRuntime } from "@/shared/lvgl"

const wasm = readFileSync(new URL("../shared/lvgl/runtime/kiln-rt.wasm", import.meta.url))

it("names the layer a tap lands on, for recording replays", async () => {
  const rt = await LvglRuntime.load(wasm, () => {})
  const project = createSampleProject()
  const home = project.screens[0]
  const byName = (name: string) => allNodes(project).find(n => n.name === name)!
  const boxes = renderScreen(rt, project, home.id).rects
  const centre = (name: string) => {
    const b = boxes.get(byName(name).id)!
    return [b.x + b.w / 2, b.y + b.h / 2] as const
  }
  const player = new ProjectPlayer(rt, project, home.id)
  // the icon inside the settings button isn't clickable: the tap is the button's
  expect(player.layerAt(...centre("settings_icon"))).toBe(byName("settings_button").id)
  expect(player.layerAt(...centre("settings_button"))).toBe(byName("settings_button").id)
  // the screen's own background is no layer
  expect(player.layerAt(2, 2)).toBeNull()
  player.dispose()
})
