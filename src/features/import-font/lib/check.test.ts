import { expect, it } from "vitest"
import { MAX_FONT_BYTES, fontFileProblem } from "./check"

const file = (tag: string, size = 64) => {
  const bytes = new Uint8Array(size)
  bytes.set([...tag].map(c => c.charCodeAt(0)))
  return bytes
}

it("takes TrueType, OpenType and collections, and says why it won't take the rest", () => {
  for (const tag of ["\0\x01\0\0", "true", "OTTO", "ttcf"]) expect(fontFileProblem(file(tag))).toBeNull()
  expect(fontFileProblem(file("wOF2"))).toMatch(/WOFF/)
  expect(fontFileProblem(file("\x89PNG"))).toMatch(/isn't a TrueType/)
  expect(fontFileProblem(file("OTTO", MAX_FONT_BYTES + 1))).toMatch(/8 MB/)
})
