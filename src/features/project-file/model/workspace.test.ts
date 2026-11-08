import { describe, expect, it } from "vitest"
import { createEmptyProject, edit, projectApi } from "@/entities/project"
import { activate, closeTab, openTab, workspaceApi } from "./workspace"

const fresh = (name: string) => {
  const doc = createEmptyProject(name)
  return { doc, size: null, path: null, saved: doc, past: [], future: [] }
}

describe("project tabs", () => {
  it("keeps each tab's project and undo history while another is open", async () => {
    openTab(fresh("A"))
    const a = workspaceApi.getState().active!
    edit(d => void (d.name = "A, renamed"))
    openTab(fresh("B"))
    expect(projectApi.getState().doc.name).toBe("B")
    expect(workspaceApi.getState().tabs).toHaveLength(2)

    activate(a)
    expect(projectApi.getState().doc.name).toBe("A, renamed")
    projectApi.getState().undo()
    expect(projectApi.getState().doc.name).toBe("A")
    // back at its saved state, so closing it doesn't need asking
    expect(projectApi.getState().doc).toBe(projectApi.getState().saved)

    expect(await closeTab(a)).toBe(true)
    expect(projectApi.getState().doc.name).toBe("B")
    const b = workspaceApi.getState().active!
    expect(await closeTab(b)).toBe(true)
    expect(workspaceApi.getState()).toMatchObject({ tabs: [], active: null, home: true })
  })
})
