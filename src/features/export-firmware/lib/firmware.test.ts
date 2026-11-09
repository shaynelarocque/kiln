import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { BUNDLED_BOARDS, findBoard } from "@/entities/board"
import { createSampleProject } from "@/entities/project"
import { budgetFor, generateFirmware, usedFonts } from "./firmware"

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

  it("gives a 4 MB ESP32's flash to the app, and leaves bigger chips their own table", () => {
    const ini = (board: string) => {
      const p = structuredClone(project)
      p.target.board = board
      return generateFirmware(p, findBoard(BUNDLED_BOARDS, board)).find(
        f => f.path === "platformio.ini",
      )!.content
    }
    expect(ini("esp32-c3-devkitm-1")).toContain("board_build.partitions = huge_app.csv")
    expect(ini("esp32-s3-devkitc-1")).not.toContain("board_build.partitions")
    expect(budgetFor(project, findBoard(BUNDLED_BOARDS, "esp32-c3-devkitm-1")).flash.total).toBe(
      3 * 1024 * 1024,
    )
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

  it("reads a capacitive touch panel over I2C, and buttons as a keypad", () => {
    const p = structuredClone(project)
    p.target.display.touch = {
      driver: "cst816s",
      pins: { sda: 4, scl: 5, int: 0, rst: 1, cs: -1, sck: -1, mosi: -1, miso: -1 },
      ...{ xMin: 0, xMax: 239, yMin: 0, yMax: 239, rotation: 0 },
    }
    p.target.buttons = [
      { id: "a", name: "Next", pin: 8, activeLow: true, key: "next" },
      { id: "b", name: "Select", pin: 9, activeLow: true, key: "enter" },
    ]
    const out = generateFirmware(p, findBoard(BUNDLED_BOARDS, p.target.board))
    const get = (path: string) => out.find(f => f.path === path)!.content
    const lgfx = get("include/lgfx_user.hpp")
    expect(lgfx).toContain("lgfx::Touch_CST816S touch;")
    // the C3 has one I2C controller
    expect(lgfx).toContain("t.i2c_port = 0;")
    expect(lgfx).toContain("t.i2c_addr = 0x15;")
    expect(lgfx).toContain("t.bus_shared = false;")
    expect(lgfx).toContain("panel.setTouch(&touch);")
    const main = get("src/main.cpp")
    expect(main).toContain("if (tft.getTouch(&x, &y)) {")
    expect(main).toContain("lv_indev_set_type(touch, LV_INDEV_TYPE_POINTER);")
    expect(main).toContain("{9, true, LV_KEY_ENTER}, /* Select */")
    // the keypad exists before the first screen loads and hands it its focus group
    expect(main.indexOf("lv_indev_set_read_cb(keys, buttons_read);")).toBeLessThan(
      main.indexOf("ui_init();"),
    )
    expect(get("src/ui/ui.c")).toContain("kiln_focus_add(ui_home, ui_settings_button);")
  })

  it("puts a resistive panel on the display's SPI bus, or on one of its own", () => {
    const p = structuredClone(project)
    p.target.board = "esp32dev"
    const { sck, mosi } = p.target.display.pins
    p.target.display.touch = {
      driver: "xpt2046",
      pins: { sda: -1, scl: -1, int: -1, rst: -1, cs: 21, sck, mosi, miso: 19 },
      ...{ xMin: 300, xMax: 3900, yMin: 400, yMax: 3900, rotation: 2 },
    }
    const lgfx = (board: string) =>
      generateFirmware(p, findBoard(BUNDLED_BOARDS, board)).find(
        f => f.path === "include/lgfx_user.hpp",
      )!.content
    const shared = lgfx("esp32dev")
    expect(shared).toContain("lgfx::Touch_XPT2046 touch;")
    expect(shared).toContain("t.spi_host = VSPI_HOST;")
    expect(shared).toContain("t.bus_shared = true;")
    // the bus reads the touch chip back, so it needs MISO and a 4-wire setup
    expect(shared).toContain("b.pin_miso = 19;")
    expect(shared).toContain("b.spi_3wire = false;")
    expect(shared).toContain("t.offset_rotation = 2;")

    Object.assign(p.target.display.touch.pins, { sck: 25, mosi: 32 })
    const own = lgfx("esp32dev")
    expect(own).toContain("t.spi_host = HSPI_HOST;")
    expect(own).toContain("t.bus_shared = false;")
    expect(own).toContain("b.pin_miso = -1;")
    // a C3 has no second SPI bus to give it: the build stops with what to rewire
    p.target.board = "esp32-c3-devkitm-1"
    expect(lgfx("esp32-c3-devkitm-1")).toContain("#error")
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
