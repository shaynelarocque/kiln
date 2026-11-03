import { describe, expect, it } from "vitest"
import { createEmptyProject, createNode, createVariable } from "./factory"
import { createInstance, detachInstance, expandInstance, instanceChildId, instancesOf, makeComponent, resolveScreens } from "./components"
import { locate } from "./mutations"

function withCard() {
  const p = createEmptyProject()
  const title = createNode("label", { name: "title", props: { text: "Temp", longMode: "LV_LABEL_LONG_MODE_WRAP" } })
  const value = createNode("label", { name: "value", props: { text: "--", longMode: "LV_LABEL_LONG_MODE_WRAP" } })
  const a = createVariable("a")
  const b = createVariable("b")
  value.bindings = [{ kind: "text", variable: a.id, format: "%d" }]
  const card = createNode("container", { name: "card", children: [title, value] })
  p.variables.push(a, b)
  p.screens[0].children.push(card)
  return { p, card, title, value, a, b }
}

describe("components", () => {
  it("moves the node to the Components screen and leaves an instance", () => {
    const { p, card } = withCard()
    const instanceId = makeComponent(p, card.id)!
    const library = p.screens.find(s => s.library)!
    expect(library.children[0].id).toBe(card.id)
    expect(locate(p, instanceId)!.node.component).toBe(card.id)
    expect(instancesOf(p, card.id).map(n => n.id)).toEqual([instanceId])
    // a component can't be made from a component or from the library itself
    expect(makeComponent(p, instanceId)).toBeNull()
    expect(makeComponent(p, card.id)).toBeNull()
  })

  it("expands instances with their overrides, and leaves the library out of builds", () => {
    const { p, card, title, value, b } = withCard()
    makeComponent(p, card.id)
    const second = createInstance(p, card.id, "card_2")!
    second.overrides = { [title.id]: { props: { text: "Humidity" } }, [value.id]: { variable: b.id } }
    p.screens[0].children.push(second)

    const expanded = expandInstance(p, second)
    expect(expanded.id).toBe(second.id)
    expect(expanded.children[0].id).toBe(instanceChildId(second.id, title.id))
    expect(expanded.children[0].props.text).toBe("Humidity")
    expect(expanded.children[1].bindings[0].variable).toBe(b.id)

    expect(resolveScreens(p, false).map(s => s.name)).toEqual(["Home"])
    expect(resolveScreens(p, true).map(s => s.name)).toEqual(["Home", "Components"])
    expect(resolveScreens(p, false)[0].children.every(n => !n.component && n.children.length === 2)).toBe(true)
  })

  it("detaches into an independent copy", () => {
    const { p, card } = withCard()
    const id = makeComponent(p, card.id)!
    detachInstance(p, id)
    const node = locate(p, id)!.node
    expect(node.component).toBeUndefined()
    expect(node.children.map(c => c.name)).toEqual(["title", "value"])
    expect(node.children.every(c => !c.id.includes("/"))).toBe(true)
  })
})
