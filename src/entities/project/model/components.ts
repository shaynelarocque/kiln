import { createScreen, newId } from "./factory"
import { locate } from "./mutations"
import type { Node, Override, Project, Screen } from "./types"

/**
 * Components, Figma-style. A main component is a node on the "Components" screen (a library
 * screen: shown on the canvas, never exported). An instance is a node whose `component` names
 * its main; it has no children of its own. compile() expands instances, so the preview and the
 * export build each instance as plain widgets.
 */

export const isLibrary = (s: Screen) => Boolean(s.library)

const walkNodes = (node: Node, fn: (n: Node) => void) => {
  fn(node)
  node.children.forEach(c => walkNodes(c, fn))
}

/** id of the expanded copy of main-component node `id` inside an instance */
export const instanceChildId = (instanceId: string, mainNodeId: string) => `${instanceId}/${mainNodeId}`

export function findMain(project: Project, id: string): Node | undefined {
  for (const screen of project.screens.filter(isLibrary)) for (const c of screen.children) if (c.id === id) return c
}

/** An instance as plain nodes: the main's tree with fresh ids, the instance's placement and overrides. */
export function expandInstance(project: Project, instance: Node, depth = 0): Node {
  const main = instance.component ? findMain(project, instance.component) : undefined
  if (!main || depth > 8) return { ...instance, component: undefined, children: [] }
  const copy = (n: Node): Node => {
    const o: Override = instance.overrides?.[n.id] ?? {}
    const node: Node = {
      ...n,
      id: instanceChildId(instance.id, n.id),
      props: { ...n.props, ...o.props },
      bindings: o.variable ? n.bindings.map(b => ({ ...b, variable: o.variable! })) : n.bindings,
      events: n.events.map(e => ({ ...e, id: instanceChildId(instance.id, e.id) })),
      children: n.children.map(copy),
    }
    // nested instances expand inside this one
    return node.component ? expandInstance(project, { ...node, id: node.id }, depth + 1) : node
  }
  const root = copy(main)
  const style = { ...root.style }
  for (const [sel, props] of Object.entries(instance.style)) style[sel] = { ...style[sel], ...props }
  return {
    ...root,
    id: instance.id,
    name: instance.name,
    layout: instance.layout,
    style,
    classes: [...root.classes, ...instance.classes],
    hidden: instance.hidden ?? root.hidden,
    bindings: [...root.bindings, ...instance.bindings],
    events: [...root.events, ...instance.events],
    component: undefined,
  }
}

/**
 * The screens as LVGL should build them: instances expanded, and, unless `keepLibrary`,
 * the Components screen left out (it's for editing, not for the board).
 */
export function resolveScreens(project: Project, keepLibrary: boolean): Screen[] {
  const hasInstances = project.screens.some(s => {
    let found = false
    walkNodes(s, n => void (found ||= Boolean(n.component)))
    return found
  })
  const screens = keepLibrary ? project.screens : project.screens.filter(s => !isLibrary(s))
  if (!hasInstances) return screens
  const resolve = (n: Node): Node => (n.component ? expandInstance(project, n) : { ...n, children: n.children.map(resolve) })
  return screens.map(s => ({ ...s, children: s.children.map(resolve) }))
}

/** Turns a node into a main component on the Components screen, leaving an instance in its place. */
export function makeComponent(project: Project, nodeId: string): string | null {
  const hit = locate(project, nodeId)
  if (!hit?.parent || hit.node.component) return null
  const inLibrary = project.screens.filter(isLibrary).some(s => locate({ ...project, screens: [s] }, nodeId))
  if (inLibrary) return null
  let library = project.screens.find(isLibrary)
  if (!library) {
    const { width } = project.target.display
    const x = Math.max(...project.screens.map(s => s.frame.x)) + width + 160
    library = { ...createScreen("Components", project.target.display, { x, y: 0 }), library: true }
    library.layout.flex = { flow: "LV_FLEX_FLOW_COLUMN", main: "LV_FLEX_ALIGN_START", cross: "LV_FLEX_ALIGN_CENTER", track: "LV_FLEX_ALIGN_CENTER" }
    library.style = { "main:default": { ...project.screens[0].style["main:default"], pad_top: 12, pad_bottom: 12, pad_row: 12 } }
    library.scrollable = true
    project.screens.push(library)
  }
  const main = hit.node
  const instance: Node = {
    id: newId(),
    name: `${main.name}_1`,
    widget: main.widget,
    props: {},
    layout: { ...main.layout },
    style: {},
    classes: [],
    bindings: [],
    events: [],
    children: [],
    component: main.id,
  }
  hit.parent.children.splice(hit.index, 1, instance)
  main.layout = { ...main.layout, x: 0, y: 0, align: "LV_ALIGN_TOP_LEFT" }
  library.children.push(main)
  return instance.id
}

/** A new instance of a main component. */
export function createInstance(project: Project, mainId: string, name: string): Node | null {
  const main = findMain(project, mainId)
  if (!main) return null
  return { id: newId(), name, widget: main.widget, props: {}, layout: { ...main.layout }, style: {}, classes: [], bindings: [], events: [], children: [], component: main.id }
}

/** Replaces an instance with an independent copy of what it shows. */
export function detachInstance(project: Project, instanceId: string) {
  const hit = locate(project, instanceId)
  if (!hit?.parent || !hit.node.component) return
  const expanded = expandInstance(project, hit.node)
  const fresh = (n: Node): Node => ({ ...n, id: n.id === instanceId ? n.id : newId(), events: n.events.map(e => ({ ...e, id: newId() })), children: n.children.map(fresh) })
  hit.parent.children.splice(hit.index, 1, fresh(expanded))
}

export const instancesOf = (project: Project, mainId: string) => {
  const out: Node[] = []
  for (const s of project.screens) walkNodes(s, n => n.component === mainId && out.push(n))
  return out
}

/**
 * The screen a node shows on when the UI runs: its own, or, for a main component and its
 * layers (which live on the Components screen), the screen of the first instance.
 */
export function liveScreenOf(project: Project, id: string, depth = 0): Screen | undefined {
  const contains = (n: Node) => {
    let hit = false
    walkNodes(n, x => void (hit ||= x.id === id))
    return hit
  }
  const screen = project.screens.find(contains)
  if (!screen || !isLibrary(screen) || depth > 8) return screen
  const main = screen.children.find(contains)
  const instance = main && instancesOf(project, main.id)[0]
  return instance && liveScreenOf(project, instance.id, depth + 1)
}
