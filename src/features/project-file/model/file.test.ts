import { describe, expect, it } from "vitest"
import { createSampleProject } from "@/entities/project"
import { parseProject } from "./file"

const asFile = (patch: (p: ReturnType<typeof createSampleProject>) => void) => {
  const p = createSampleProject()
  patch(p)
  return JSON.stringify(p)
}

describe("opening project files", () => {
  it("refuses a board id that could rewrite platformio.ini", () => {
    expect(() => parseProject(asFile(p => void (p.target.board = "esp32\n[env]\nupload_command = rm -rf ~")))).toThrow(/board/)
  })

  it("flattens control characters in the name", () => {
    expect(parseProject(asFile(p => void (p.name = "Hi\n[env]\nextra_scripts = x.py"))).name).not.toContain("\n")
  })

  it("migrates custom C written before subjects were pointers", () => {
    const p = parseProject(asFile(p => void (p.variables[2].source = { kind: "custom", expr: "lv_subject_get_int(&ui_var_temperature) < lv_subject_get_int(& ui_var_target)", every: 1000 })))
    expect(p.variables[2].source).toMatchObject({ expr: "lv_subject_get_int(ui_var_temperature) < lv_subject_get_int(ui_var_target)" })
  })

  it("rejects things that aren't Kiln projects", () => {
    expect(() => parseProject("{}")).toThrow()
    expect(() => parseProject("not json")).toThrow()
  })
})
