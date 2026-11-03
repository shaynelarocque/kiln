import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { BUNDLED_BOARDS, findBoard } from "@/entities/board"
import {
  allNodes,
  atSize,
  compile,
  createPetProject,
  ProjectPlayer,
  walk,
} from "@/entities/project"
import { generateFirmware } from "@/features/export-firmware"
import { LvglRuntime, Scene } from "@/shared/lvgl"

const lvgl = new URL("../../runtime/lvgl", import.meta.url).pathname
const wasm = readFileSync(new URL("../shared/lvgl/runtime/kiln-rt.wasm", import.meta.url))

describe("the breathalyzer pet", () => {
  const pet = createPetProject()
  const sizes = [null, ...pet.sizes.map(s => s.id)]

  it.each(sizes)("plays at every size, and its face follows the booze (size %s)", async size => {
    const logs: string[] = []
    const rt = await LvglRuntime.load(wasm, m => logs.push(m))
    const project = atSize(pet, size)
    const program = compile(project, "play")
    const { width, height } = project.target.display
    const display = rt.createDisplay(width, height)
    display.setTheme(project.theme)
    display.makeDefault()
    const setup = new Scene(rt)
    setup.run(program.setup)
    const scene = new Scene(rt, setup)
    for (const s of program.screens) scene.run(s.ops)
    scene.run(program.wiring)
    rt.x.lv_screen_load(scene.screen(0))

    // visible counts its parents too: the tipsy face hides with its group
    const shown = (name: string) =>
      rt.x.lv_obj_is_visible(scene.get("obj", allNodes(project).find(n => n.name === name)!.id)!)
    const booze = setup.get("subject", project.variables[0].id)!
    const faces = (level: number) => {
      rt.x.lv_subject_set_int(booze, level)
      rt.tick(50)
      return ["sober_face", "tipsy", "tipsy_face", "wasted_face", "dizzy"].filter(shown)
    }
    expect(faces(10)).toEqual(["sober_face", "tipsy"])
    // the tipsy face needs both its group (booze ≤ 70) and its own binding (booze > 30)
    expect(faces(50)).toEqual(["tipsy", "tipsy_face"])
    expect(faces(90)).toEqual(["wasted_face", "dizzy"])
    // the pixel art for each mood: sparkles, hiccup bubbles, then snoring once it's out. The
    // bubbles and the hiccup line sit in content-sized groups, which must grow when they show
    const art = (level: number) => {
      rt.x.lv_subject_set_int(booze, level)
      rt.tick(50)
      return ["sparkles", "bubbles", "say_hic", "zzz"].filter(shown)
    }
    expect(art(10)).toEqual(["sparkles"])
    expect(art(50)).toEqual(["bubbles", "say_hic"])
    expect(art(80)).toEqual([])
    expect(art(95)).toEqual(["zzz"])
    for (let t = 0; t < 3000; t += 33) rt.tick(33)

    display.release()
    scene.dispose()
    setup.dispose()
    display.delete()
    expect(logs.filter(l => /error|assert/i.test(l))).toEqual([])
  })

  it("sounds its alarm in Play: Play runs the alarm's C expression on the simulated booze", async () => {
    // Play blits to a canvas; here the frames go nowhere
    globalThis.ImageData ??= class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
      ) {}
    } as never
    const ctx = { putImageData() {} } as unknown as CanvasRenderingContext2D
    const rt = await LvglRuntime.load(wasm, () => {})
    const project = createPetProject()
    const booze = project.variables.find(v => v.name === "booze")!
    const alarm = project.variables.find(v => v.name === "alarm")!
    // read every frame, so it never lags the booze it reads
    if (alarm.source?.kind === "custom") alarm.source.every = 5
    const player = new ProjectPlayer(rt, project, project.screens[0].id)
    const seen = new Set<number>()
    for (let t = 0; t < 14000; t += 50) {
      player.frame(50, ctx)
      expect(player.get(alarm.id)).toBe(player.get(booze.id) > 70 ? 1 : 0)
      seen.add(player.get(alarm.id))
    }
    // the booze simulation swings past 70 and back
    expect([...seen].sort()).toEqual([0, 1])
    player.dispose()
  })

  it("costs the board nothing: a size's export matches a project that never had sizes", () => {
    const board = findBoard(BUNDLED_BOARDS, pet.target.board)
    const bare = structuredClone(pet)
    bare.sizes = []
    for (const screen of bare.screens) walk(screen, n => void delete n.at)
    const files = (p: typeof pet) => generateFirmware(p, board).map(f => [f.path, f.content])
    expect(files(atSize(pet, null))).toEqual(files(bare))
  })

  it.runIf(existsSync(lvgl))("exports C that compiles at every size", () => {
    for (const size of sizes) {
      const project = atSize(pet, size)
      const files = generateFirmware(project, findBoard(BUNDLED_BOARDS, project.target.board))
      const dir = mkdtempSync(join(tmpdir(), "kiln-pet-"))
      for (const f of files) {
        mkdirSync(dirname(join(dir, f.path)), { recursive: true })
        writeFileSync(join(dir, f.path), f.content)
      }
      for (const f of files.filter(f => /^src\/ui\/.*\.c$/.test(f.path)))
        execFileSync(
          "cc",
          [
            "-fsyntax-only",
            "-std=c11",
            "-Wall",
            "-Werror=implicit-function-declaration",
            "-Werror=incompatible-pointer-types",
            "-Werror=int-conversion",
            "-Werror=deprecated-declarations",
            "-Wno-unused-variable",
            "-DLV_CONF_INCLUDE_SIMPLE",
            `-I${dir}/include`,
            `-I${lvgl}`,
            join(dir, f.path),
          ],
          { stdio: "pipe" },
        )
      const conf = files.find(f => f.path === "include/lgfx_user.hpp")!.content
      expect(conf).toContain(size ? "Panel_ST7735S" : "Panel_GC9A01")
    }
  })
})
