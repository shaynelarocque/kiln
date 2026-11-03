import { describe, expect, it } from "vitest"
import { parseExpr, type ExprEnv } from "./expr"

const variables = { ui_var_booze: "booze", ui_var_temperature: "temp", ui_var_target: "target" }

/** Runs an expression the way Play does, with these variable values. */
function run(src: string, values: Record<string, number> = {}, env: Partial<ExprEnv> = {}) {
  const parsed = parseExpr(src, variables)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.run({ get: id => values[id] ?? 0, now: 0, random: () => 0, ...env })
}

const error = (src: string) => {
  const parsed = parseExpr(src, variables)
  return parsed.ok ? null : parsed.error
}

describe("C expression sources in Play", () => {
  it("runs the samples' expressions", () => {
    expect(run("lv_subject_get_int(ui_var_booze) > 70", { booze: 80 })).toBe(1)
    expect(run("lv_subject_get_int(ui_var_booze) > 70", { booze: 50 })).toBe(0)
    const heating = "lv_subject_get_int(ui_var_temperature) < lv_subject_get_int(ui_var_target)"
    expect(run(heating, { temp: 19, target: 21 })).toBe(1)
    expect(parseExpr(heating, variables)).toMatchObject({ uses: ["temp", "target"] })
  })

  it("does maths like C on a 32-bit int", () => {
    expect(run("7 / 2")).toBe(3)
    expect(run("-7 / 2")).toBe(-3)
    expect(run("-7 % 3")).toBe(-1)
    expect(run("2147483647 + 1")).toBe(-2147483648)
    expect(run("1 << 31")).toBe(-2147483648)
    expect(run("65536 * 65536")).toBe(0)
    // a leading 0 is octal; hex and binary too
    expect(run("010 + 0x10 + 0b11")).toBe(27)
    expect(run("100u + 5L")).toBe(105)
    // a double turns that operation into a double one, and the result is truncated at the end
    expect(run("7 / 2.0")).toBe(3)
    expect(run("(7 / 2) * 1.5")).toBe(4)
    expect(run("7 / 2 * 1.5")).toBe(4)
    expect(run("(int)(lv_subject_get_int(ui_var_booze) * 0.5)", { booze: 45 })).toBe(22)
    expect(run("(uint8_t)300 + (int16_t)40000 + (bool)7")).toBe(44 - 25536 + 1)
    expect(run("~5 & 0xff ^ 1 | 8")).toBe(((~5 & 0xff) ^ 1) | 8)
    expect(run("1 / 0")).toBe(0)
  })

  it("follows C's precedence, short-circuits, and nests the ternary to the right", () => {
    expect(run("1 + 2 * 3 << 1")).toBe(14)
    expect(run("1 < 2 == 1")).toBe(1)
    expect(run("!0 && (3 > 2 || random(5))")).toBe(1)
    expect(run("0 && lv_subject_get_int(ui_var_booze)")).toBe(0)
    expect(run("0 ? 1 : 2 ? 3 : 4")).toBe(3)
    expect(run("-(-5) - -5")).toBe(10)
  })

  it("has LVGL's and Arduino's helpers", () => {
    expect(run("lv_map(50, 0, 100, 0, 255)")).toBe(127)
    expect(run("lv_map(150, 0, 100, 0, 255)")).toBe(255)
    expect(run("lv_map(25, 100, 0, 0, 10)")).toBe(7)
    expect(run("LV_CLAMP(0, 120, 100) + LV_MIN(3, 4) + LV_MAX(3, 4) + LV_ABS(-2)")).toBe(109)
    expect(run("millis() / 1000", {}, { now: 4500 })).toBe(4)
    expect(run("random(10)", {}, { random: () => 0.95 })).toBe(9)
    expect(run("random(5, 8)", {}, { random: () => 0.5 })).toBe(6)
  })

  it("says what it can't run, instead of guessing", () => {
    expect(error("my_sensor_read() / 4")).toMatch(/my_sensor_read\(\) is code on the board/)
    expect(error("digitalRead(4)")).toMatch(/digitalRead\(\) is code on the board/)
    expect(error("ui_var_booze > 3")).toMatch(/lv_subject_get_int\(ui_var_booze\)/)
    expect(error("lv_subject_get_int(ui_var_nope)")).toMatch(/isn't one of this project's/)
    expect(error("3 +")).toMatch(/ends too soon/)
    expect(error("(3")).toMatch(/expected “\)”/)
    expect(error("3 3")).toMatch(/out of place/)
    expect(error('"hi"')).toMatch(/isn't something Play can read/)
    expect(error("")).toMatch(/empty/)
    expect(error("lv_map(1, 2)")).toMatch(/takes 5 arguments/)
  })
})
