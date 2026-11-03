import { expect, it } from "vitest"
import { cComment, cString } from "./c"

it("writes C strings that compile, whatever the text", () => {
  expect(cString('say "hi"\n')).toBe('"say \\"hi\\"\\n"')
  // a hex escape swallows following hex digits, so the literal is split
  expect(cString("\u0001ABC")).toBe('"\\x01" "ABC"')
  expect(cString("°C")).toBe('"\\xC2\\xB0" "C"')
  expect(cString(" Home")).toBe('LV_SYMBOL_HOME " Home"')
  expect(cString("")).toBe('""')
})

it("keeps user text inside a comment", () => {
  expect(cComment("evil */ int x; /*")).toBe("evil * / int x; /*")
  expect(cComment("a\nb")).toBe("a b")
})
