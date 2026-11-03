import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { BUNDLED_BOARDS, findBoard } from "@/entities/board"
import { createSampleProject } from "@/entities/project"
import { generateFirmware, usedFonts } from "./firmware"

const lvgl = new URL("../../../../runtime/lvgl", import.meta.url).pathname
const project = createSampleProject()
const files = generateFirmware(project, findBoard(BUNDLED_BOARDS, project.target.board))
const file = (path: string) => files.find(f => f.path === path)!.content

describe("firmware export", () => {
  it("lays out a PlatformIO project and never clobbers app.cpp", () => {
    expect(files.map(f => f.path)).toEqual(
      expect.arrayContaining([
        "platformio.ini",
        "include/lv_conf.h",
        "include/lgfx_user.hpp",
        "src/main.cpp",
        "src/kiln_hw.cpp",
        "src/ui/ui.h",
        "src/ui/ui.c",
        "src/ui/ui_home.c",
        "src/ui/ui_settings.c",
        "src/ui/kiln_helpers.c",
        "src/app.cpp",
      ]),
    )
    expect(files.find(f => f.path === "src/app.cpp")!.overwrite).toBe(false)
    expect(file("platformio.ini")).toContain("board = esp32-c3-devkitm-1")
    expect(file("include/lgfx_user.hpp")).toContain("lgfx::Panel_GC9A01")
  })

  it("compiles in only the fonts the UI uses", () => {
    expect(usedFonts(project)).toEqual([
      "lv_font_montserrat_14",
      "lv_font_montserrat_16",
      "lv_font_montserrat_18",
      "lv_font_montserrat_20",
      "lv_font_montserrat_48",
    ])
    expect(file("include/lv_conf.h")).toContain("#define LV_FONT_MONTSERRAT_48 1")
    expect(file("include/lv_conf.h")).not.toContain("MONTSERRAT_22")
  })

  it("wires hardware: ADC in, digital and PWM out", () => {
    const hw = file("src/kiln_hw.cpp")
    expect(hw).toContain("lv_map(analogRead(0), 0, 4095, 10, 35)")
    expect(hw).toContain("digitalWrite(1, lv_subject_get_int(s) ? HIGH : LOW)")
    expect(hw).toContain("analogWrite(3, lv_map(lv_subject_get_int(s), 5, 100, 0, 255))")
    // the backlight is PWM-driven by `brightness`, so it isn't also forced on
    expect(hw).not.toContain("digitalWrite(3, HIGH)")
  })

  it("reads like LVGL code", () => {
    const home = file("src/ui/ui_home.c")
    expect(home).toContain("ui_dial = lv_arc_create(ui_home);")
    expect(home).toContain(
      "lv_obj_set_style_arc_color(ui_dial, lv_color_hex(UI_COLOR_ACCENT), LV_PART_INDICATOR | LV_STATE_DEFAULT);",
    )
    expect(home).toContain(
      'lv_label_bind_text(ui_temperature, ui_var_temperature, "%d\\xC2\\xB0");',
    )
    expect(home).toContain('lv_label_set_text(ui_heating_icon, LV_SYMBOL_CHARGE " Heating");')
    expect(file("src/ui/ui.c")).toContain(
      "lv_obj_add_screen_load_event(ui_settings_button, LV_EVENT_CLICKED, ui_settings, LV_SCREEN_LOAD_ANIM_MOVE_LEFT, 300, 0);",
    )
  })

  it.runIf(existsSync(lvgl))("compiles against LVGL 9.6", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiln-export-"))
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
