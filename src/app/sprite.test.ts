import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { BUNDLED_BOARDS, findBoard } from "@/entities/board"
import {
  compile,
  createEmptyProject,
  createNode,
  createScreen,
  newId,
  type Project,
  type Sprite,
} from "@/entities/project"
import { generateFirmware } from "@/features/export-firmware"
import { convert } from "@/features/import-image"
import { toBase64 } from "@/shared/lib/base64"
import { LvglRuntime, Scene } from "@/shared/lvgl"

const lvgl = new URL("../../runtime/lvgl", import.meta.url).pathname

/** A 2×2 sprite whose frames are flat greys, 100 ms each. */
function sprite(frames: number): Sprite {
  return {
    id: newId(),
    name: "boot",
    width: 2,
    height: 2,
    format: "RGB565",
    dither: false,
    frameMs: 100,
    stride: 4,
    frames: Array.from({ length: frames }, (_, i) => ({
      png: "",
      data: toBase64(convert(new Uint8Array(16).fill(40 + i * 60), 2, 2, "RGB565", false).data),
    })),
  }
}

/** A boot animation: the sprite plays once on the first screen, then opens Home. */
function bootProject() {
  const p = createEmptyProject()
  const s = sprite(3)
  p.sprites.push(s)
  const home = createScreen("Home", p.target.display, { x: 400, y: 0 })
  p.screens.push(home)
  const boot = createNode("sprite", {
    name: "boot_anim",
    props: { sprite: s.id, speed: 100, once: true, scale: 512, antialias: false },
    events: [
      {
        id: newId(),
        trigger: "LV_EVENT_READY",
        action: {
          type: "navigate",
          screen: home.id,
          anim: "LV_SCREEN_LOAD_ANIM_NONE",
          duration: 0,
          delay: 0,
        },
      },
    ],
  })
  p.screens[0].children = [boot]
  return { p, boot, home }
}

describe("sprites", () => {
  it("play their frames on the wasm LVGL, then say they're done (a boot animation)", async () => {
    const { p, boot } = bootProject()
    const rt = await LvglRuntime.load(
      readFileSync(new URL("../shared/lvgl/runtime/kiln-rt.wasm", import.meta.url)),
      () => {},
    )
    const program = compile(p, "play")
    const display = rt.createDisplay(240, 240)
    display.makeDefault()
    const setup = new Scene(rt)
    setup.run(program.setup)
    const scene = new Scene(rt, setup)
    for (const s of program.screens) scene.run(s.ops)
    scene.run(program.wiring)
    rt.x.lv_screen_load(scene.screen(0))
    const obj = scene.get("obj", boot.id)!
    const seen = new Set<number>()
    for (let t = 0; t < 280; t += 20) {
      rt.tick(20)
      seen.add(rt.x.lv_image_get_src(obj))
    }
    expect(seen.size).toBe(3)
    // zoomed 2×, and sized to match
    expect(rt.coords(obj)).toMatchObject({ w: 4, h: 4 })
    for (let t = 0; t < 300; t += 20) rt.tick(20)
    expect(rt.x.lv_display_get_screen_active(display.ptr)).toBe(scene.screen(1))
    display.release()
    scene.dispose()
    setup.dispose()
    display.delete()
  })

  it("compile only what's played, into a frame array for lv_animimg", () => {
    const { p } = bootProject()
    const unused: Sprite = { ...sprite(5), name: "unused" }
    p.sprites.push(unused)
    const { setup } = compile(p, "export")
    expect(setup.filter(op => op.op === "frames").map(op => op.id)).toEqual([p.sprites[0].id])
    expect(setup.filter(op => op.op === "image")).toHaveLength(3)
  })

  it.runIf(existsSync(lvgl))("export C that compiles against LVGL 9.6", () => {
    const { p } = bootProject()
    const files = generateFirmware(p, findBoard(BUNDLED_BOARDS, p.target.board))
    const ui = files.find(f => f.path === "src/ui/ui.c")!.content
    expect(ui).toContain(
      "const void * ui_spr_boot[] = { &ui_spr_boot_0, &ui_spr_boot_1, &ui_spr_boot_2 };",
    )
    expect(files.find(f => f.path === "src/ui/ui.h")!.content).toContain(
      "extern const void * ui_spr_boot[3];",
    )
    const screen = files.find(f => f.path === "src/ui/ui_home.c" || f.path.includes("ui_home"))
    const first = files.find(f => f.content.includes("lv_animimg_create"))!.content
    expect(first).toContain("lv_animimg_set_src(ui_boot_anim, ui_spr_boot, 3);")
    expect(first).toContain("lv_animimg_set_repeat_count(ui_boot_anim, 1);")
    expect(screen).toBeTruthy()
    const dir = mkdtempSync(join(tmpdir(), "kiln-sprite-"))
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
  })
})

export type { Project }
