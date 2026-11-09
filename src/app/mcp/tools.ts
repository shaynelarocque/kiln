/**
 * What Kiln's MCP server offers (src-tauri/src/mcp.rs speaks the protocol and hands calls here).
 * The tools act on the open project through the same store as the editor: each edit is one
 * undo step, shows on the canvas at once, and selects what it touched.
 */
import { deviceApi, deviceStore, stripAnsi } from "@/entities/device"
import { editorApi } from "@/entities/editor"
import {
  allNodes,
  canContain,
  createNode,
  createScreen,
  createVariable,
  edit,
  findNode,
  insertNode,
  isLibrary,
  locate,
  moveNode,
  newId,
  projectApi,
  removeNodes,
  renderScreen,
  screenOf,
  uniqueName,
  walk,
  type Action,
  type Binding,
  type Compare,
  type Layout,
  type Node,
  type Project,
  type Screen,
  type StyleMap,
} from "@/entities/project"
import { build, exportFolder, openMonitor } from "@/features/export-firmware"
import { activate, newProject, TEMPLATES, workspaceApi } from "@/features/project-file"
import { pngDataUrl } from "@/shared/lib/png"
import { confirmAction } from "@/shared/lib/tauri"
import {
  ALIGN,
  BIND_FLAGS,
  BIND_STATES,
  COMPARE,
  EVENTS,
  FLEX_ALIGN,
  FLEX_FLOW,
  FONTS,
  INSERTABLE,
  loadRuntime,
  PARTS,
  SCREEN_LOAD_ANIM,
  STATES,
  STYLE_PROPS,
  WIDGETS,
  type LvglRuntime,
  type Rect,
  type WidgetType,
} from "@/shared/lvgl"

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
export type ToolResult = { content: Content[]; isError?: boolean }
type Args = Record<string, unknown>

type Tool = {
  name: string
  title: string
  description: string
  properties: Record<string, object>
  required?: string[]
  readOnly?: boolean
  destructive?: boolean
  run: (args: Args) => ToolResult | Promise<ToolResult>
}

/** A mistake the model can read and fix: a bad argument, a layer that isn't there. */
class ToolError extends Error {}

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] })
const json = (v: unknown) => text(JSON.stringify(v))

/*---------- arguments ----------*/

function arg<T>(a: Args, key: string, type: string, required: boolean): T | undefined {
  const v = a[key]
  if (v === undefined || v === null) {
    if (required) throw new ToolError(`${key} is required`)
    return undefined
  }
  if (type === "array" ? !Array.isArray(v) : typeof v !== type || Array.isArray(v))
    throw new ToolError(
      `${key} should be a${type === "object" || type === "array" ? "n" : ""} ${type}`,
    )
  return v as T
}
const str = (a: Args, k: string, required = false) => arg<string>(a, k, "string", required)
const num = (a: Args, k: string) => arg<number>(a, k, "number", false)
const bool = (a: Args, k: string) => arg<boolean>(a, k, "boolean", false)
const obj = (a: Args, k: string, required = false) =>
  arg<Record<string, unknown>>(a, k, "object", required)
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const oneOf = (value: unknown, options: { value: string }[], what: string) => {
  if (typeof value === "string" && options.some(o => o.value === value)) return value
  throw new ToolError(`${what} is one of ${options.map(o => o.value).join(", ")}`)
}

/*---------- the project ----------*/

/** The project in Kiln's open tab, brought to the front so the person sees what changes. */
function project(): Project {
  const { active, home } = workspaceApi.getState()
  if (!active)
    throw new ToolError("No project is open in Kiln. Open one there, or call new_project.")
  if (home) activate(active)
  return projectApi.getState().project
}

const realScreens = (p: Project) => p.screens.filter(s => !s.library)

function screenRef(p: Project, ref: string | undefined): Screen {
  if (!ref) return realScreens(p)[0] ?? p.screens[0]
  const screen =
    p.screens.find(s => s.id === ref) ??
    p.screens.find(s => s.name.toLowerCase() === ref.toLowerCase())
  if (!screen)
    throw new ToolError(
      `There's no screen "${ref}". Screens: ${p.screens.map(s => `${s.name} (${s.id})`).join(", ")}`,
    )
  return screen
}

/** A layer by id, or by name (names are unique in a project). */
function layerRef(p: Project, ref: string): Node {
  const node = findNode(p, ref) ?? allNodes(p).find(n => n.name === ref)
  if (!node) throw new ToolError(`There's no layer "${ref}"; get_screen lists them`)
  return node
}

function variableRef(p: Project, ref: string) {
  const v = p.variables.find(x => x.id === ref || x.name === ref)
  if (!v) throw new ToolError(`There's no variable "${ref}"; get_project lists them`)
  return v
}

/** A node as JSON, leaving out what's empty; `box` is where LVGL laid it out, in display pixels. */
function describe(n: Node, boxes?: Map<string, Rect>): Record<string, unknown> {
  const out: Record<string, unknown> = { id: n.id, name: n.name, widget: n.widget }
  if (n.widget !== "screen") out.layout = n.layout
  const box = boxes?.get(n.id)
  if (box) out.box = { x: box.x, y: box.y, w: box.w, h: box.h, ...(box.hidden && { hidden: true }) }
  const props = Object.fromEntries(Object.entries(n.props).filter(([, v]) => v !== null))
  if (Object.keys(props).length) out.props = props
  if (Object.keys(n.style).length) out.style = n.style
  if (n.classes.length) out.classes = n.classes
  for (const k of [
    "hidden",
    "checked",
    "disabled",
    "checkable",
    "clickable",
    "scrollable",
  ] as const)
    if (n[k] !== undefined) out[k] = n[k]
  if (n.bindings.length) out.bindings = n.bindings
  if (n.events.length) out.interactions = n.events
  if (n.transition) out.transition = n.transition
  if (n.component) out.component = n.component
  if (n.children.length) out.children = n.children.map(c => describe(c, boxes))
  return out
}

/*---------- edits ----------*/

const PART_NAMES: string[] = PARTS.map(p => p.value)
const STATE_NAMES: string[] = STATES.map(s => s.value)

function checkSelector(selector: string) {
  const [part, states = "default"] = selector.split(":")
  if (!PART_NAMES.includes(part) || states.split("+").some(s => !STATE_NAMES.includes(s)))
    throw new ToolError(
      `"${selector}" isn't a selector. Write part:state, like main:default or indicator:checked+pressed (parts: ${PART_NAMES.join(", ")}; states: ${STATE_NAMES.join(", ")})`,
    )
}

/** Merges {selector: {prop: value}} into a style; null removes a prop or a whole selector. */
function mergeStyle(style: StyleMap, patch: Record<string, unknown>) {
  for (const [selector, props] of Object.entries(patch)) {
    checkSelector(selector)
    if (props === null) {
      delete style[selector]
      continue
    }
    if (typeof props !== "object") throw new ToolError(`style["${selector}"] should be an object`)
    for (const [prop, value] of Object.entries(props as Record<string, unknown>)) {
      if (!STYLE_PROPS.some(s => s.name === prop))
        throw new ToolError(`There's no style property "${prop}"; get_catalog lists them`)
      const into = (style[selector] ??= {})
      if (value === null) delete into[prop]
      else if (["string", "number", "boolean"].includes(typeof value))
        into[prop] = value as string | number | boolean
      else throw new ToolError(`${prop} should be a string, number or boolean`)
    }
    if (style[selector] && !Object.keys(style[selector]).length) delete style[selector]
  }
}

function setProps(node: Node, patch: Record<string, unknown>) {
  const known = WIDGETS[node.widget].props.map(p => p.key)
  for (const [key, value] of Object.entries(patch)) {
    if (!known.includes(key))
      throw new ToolError(
        `A ${node.widget} has no prop "${key}"${known.length ? ` (it has ${known.join(", ")})` : ""}`,
      )
    if (value !== null && !["string", "number", "boolean"].includes(typeof value))
      throw new ToolError(`${key} should be a string, number or boolean`)
    node.props[key] = value as string | number | boolean | null
  }
}

/** A button's text lives on the label inside it. */
function setText(node: Node, value: string) {
  if (WIDGETS[node.widget].props.some(p => p.key === "text")) return void (node.props.text = value)
  const label = node.children.find(c => c.widget === "label")
  if (!label) throw new ToolError(`A ${node.widget} has no text`)
  label.props.text = value
}

const COORD = /^-?\d+(\.\d+)?%$|^content$/
function coord(v: unknown, key: string): Layout["x"] {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v)
  if (typeof v === "string" && COORD.test(v)) return v as Layout["x"]
  throw new ToolError(`${key} is pixels, a percentage like "50%", or "content"`)
}

function setLayout(node: Node, a: Args) {
  for (const k of ["x", "y", "w", "h"] as const) if (a[k] != null) node.layout[k] = coord(a[k], k)
  if (a.align != null) node.layout.align = oneOf(a.align, ALIGN, "align")
  if (a.flex === null) delete node.layout.flex
  else if (a.flex !== undefined) {
    const f = obj(a, "flex")!
    node.layout.flex = {
      flow: oneOf(f.flow ?? "LV_FLEX_FLOW_COLUMN", FLEX_FLOW, "flex.flow"),
      main: oneOf(f.main ?? "LV_FLEX_ALIGN_START", FLEX_ALIGN, "flex.main"),
      cross: oneOf(f.cross ?? "LV_FLEX_ALIGN_CENTER", FLEX_ALIGN, "flex.cross"),
      track: oneOf(f.track ?? "LV_FLEX_ALIGN_CENTER", FLEX_ALIGN, "flex.track"),
    }
  }
  if (a.grow === null) delete node.layout.grow
  else if (a.grow !== undefined) node.layout.grow = clamp(num(a, "grow")!, 0, 100)
}

const select = (ids: string[]) => editorApi.getState().select(ids)

/*---------- screenshots ----------*/

let loader: () => Promise<LvglRuntime> = loadRuntime
let runtime: Promise<LvglRuntime> | null = null

/** Tests hand in their own LVGL (the app loads its wasm by URL). */
export function setRenderRuntime(load: () => Promise<LvglRuntime>) {
  loader = load
  runtime = null
}

async function screenshot(p: Project, screen: Screen): Promise<ToolResult> {
  const rt = await (runtime ??= loader())
  let shot: ReturnType<typeof renderScreen>
  try {
    shot = renderScreen(rt, p, screen.id)
  } catch (e) {
    runtime = null // a trap leaves LVGL in no state to trust
    throw e
  }
  const { width: w, height: h, rgba, rects } = shot
  // a round panel shows a circle of its square
  if (p.target.display.round) {
    const r = Math.min(w, h) / 2
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if ((x + 0.5 - w / 2) ** 2 + (y + 0.5 - h / 2) ** 2 > r * r) rgba[(y * w + x) * 4 + 3] = 0
  }
  const lines: string[] = []
  walk(screen, (n, parent) => {
    const b = rects.get(n.id)
    if (b && parent)
      lines.push(
        `${n.name} (${n.widget}, ${n.id}): ${b.x},${b.y} ${b.w}×${b.h}${b.hidden ? " hidden" : ""}`,
      )
  })
  return {
    content: [
      { type: "image", data: pngDataUrl(w, h, rgba).split(",")[1], mimeType: "image/png" },
      {
        type: "text",
        text: `${screen.name}, ${w}×${h}${p.target.display.round ? " round" : ""}. Where each layer landed:\n${lines.join("\n") || "(no layers)"}`,
      },
    ],
  }
}

/*---------- the board ----------*/

/** Resolves once `done` holds, or after `ms`. */
function until(done: () => boolean, ms: number) {
  return new Promise<void>(resolve => {
    if (done()) return resolve()
    const timer = setTimeout(finish, ms)
    const stop = deviceStore.subscribe(() => done() && finish())
    function finish() {
      clearTimeout(timer)
      stop()
      resolve()
    }
  })
}

function needsDesktop() {
  if (!deviceApi.available()) throw new ToolError("This needs Kiln's desktop app")
}

/*---------- the tools ----------*/

const screenArg = {
  type: "string",
  description: "Screen id or name. Leave out for the first (start) screen.",
}
const layoutArgs = {
  x: { description: 'Offset from the align point: pixels, or a percentage like "50%"' },
  y: { description: "As x" },
  w: { description: 'Width: pixels, "50%" of the parent, or "content"' },
  h: { description: "As w" },
  align: {
    type: "string",
    description: "LV_ALIGN_* the offset is from (default LV_ALIGN_TOP_LEFT)",
  },
  flex: {
    type: ["object", "null"],
    description:
      "Lay children out like CSS flexbox: {flow, main, cross, track} with LV_FLEX_FLOW_* and LV_FLEX_ALIGN_* values. null turns it off.",
  },
  grow: { type: ["number", "null"], description: "flex-grow inside a flex parent" },
}
const styleArg = {
  type: "object",
  description:
    'Style per selector, like CSS: {"main:default": {"bg_color": "#1f2430", "radius": 12}, "indicator:checked": {...}}. Colours are "#rrggbb" or "$<token id>"; fonts like "lv_font_montserrat_20"; null removes a property or selector. get_catalog lists every property.',
}

export const TOOLS: Tool[] = [
  {
    name: "get_project",
    title: "Get the project",
    description:
      "The open project at a glance: its board and display, screens, variables, colour tokens, shared styles, animations, components, images and fonts.",
    properties: {},
    readOnly: true,
    run: () => {
      const p = project()
      const { doc, saved, path } = projectApi.getState()
      const start = realScreens(p)[0]
      const count = (s: Screen) => {
        let n = -1
        walk(s, () => n++)
        return n
      }
      return json({
        name: p.name,
        file: path,
        unsaved: doc !== saved,
        board: p.target.board,
        display: (({ driver, width, height, round }) => ({ driver, width, height, round }))(
          p.target.display,
        ),
        theme: p.theme,
        screens: p.screens.map(s => ({
          id: s.id,
          name: s.name,
          layers: count(s),
          ...(s === start && { start: true }),
          ...(s.library && { components: true }),
        })),
        variables: p.variables.map(({ id, name, type, initial, min, max }) => ({
          id,
          name,
          type,
          initial,
          min,
          max,
        })),
        tokens: p.tokens,
        styles: p.styles,
        animations: p.animations.map(a => ({ id: a.id, name: a.name, autoplay: a.autoplay })),
        components: p.screens
          .filter(isLibrary)
          .flatMap(s => s.children.map(c => ({ id: c.id, name: c.name }))),
        images: p.assets.map(a => ({ id: a.id, name: a.name, width: a.width, height: a.height })),
        sprites: p.sprites.map(s => ({ id: s.id, name: s.name, frames: s.frames.length })),
        fonts: p.fonts.map(f => ({ id: f.id, name: f.name, use: `ttf:${f.id}:<px>` })),
      })
    },
  },
  {
    name: "get_screen",
    title: "Get a screen's layers",
    description:
      "Every layer of a screen as a tree: layout, props, style, bindings, interactions, and box (where LVGL laid it out, in display pixels).",
    properties: { screen: screenArg },
    readOnly: true,
    run: a => {
      const p = project()
      const screen = screenRef(p, str(a, "screen"))
      return json(describe(screen, editorApi.getState().rects.get(screen.id)))
    },
  },
  {
    name: "render_screen",
    title: "See a screen",
    description:
      "A PNG of a screen drawn by the same LVGL the board runs (a round panel comes out round), plus where each layer landed.",
    properties: { screen: screenArg },
    readOnly: true,
    run: a => {
      const p = project()
      return screenshot(p, screenRef(p, str(a, "screen")))
    },
  },
  {
    name: "get_catalog",
    title: "What Kiln can make",
    description:
      "The widget types you can add, with their props, parts and value bindings; every style property with its type; and the selector parts, states, aligns, flex values, events, screen transitions and fonts.",
    properties: {},
    readOnly: true,
    run: () =>
      json({
        widgets: INSERTABLE.map(t => {
          const w = WIDGETS[t]
          return {
            type: t,
            label: w.label,
            ...(w.container && { container: true }),
            size: w.size,
            parts: w.parts,
            props: w.props.map(p => ({
              key: p.key,
              type: p.type,
              default: p.default,
              ...(p.options && { options: p.options.map(o => o.value) }),
              ...(p.min !== undefined && { min: p.min, max: p.max }),
            })),
            bindings: w.bind,
            ...(t === "button" && { note: "a button holds a label; add_widget's text sets it" }),
          }
        }),
        styleProps: STYLE_PROPS.map(s => ({
          name: s.name,
          type: s.type,
          group: s.group,
          ...(s.options && { options: s.options.map(o => o.value) }),
          ...(s.min !== undefined && { min: s.min, max: s.max }),
        })),
        units:
          "px: pixels; opa: 0-255; angle: tenths of a degree; scale: 256 = 100%; color: #rrggbb",
        parts: PART_NAMES,
        states: STATE_NAMES,
        aligns: ALIGN.map(o => o.value),
        flex: { flow: FLEX_FLOW.map(o => o.value), align: FLEX_ALIGN.map(o => o.value) },
        events: EVENTS.map(o => o.value),
        screenTransitions: SCREEN_LOAD_ANIM.map(o => o.value),
        fonts: [...FONTS.map(o => o.value), "ttf:<font id>:<px> for an imported font"],
      }),
  },
  {
    name: "add_widget",
    title: "Add a widget",
    description:
      "Adds a widget to a screen or container, centred unless you place it. Returns its id.",
    properties: {
      type: { type: "string", enum: INSERTABLE },
      parent: {
        type: "string",
        description: "Screen or container (id or name). Leave out for the first screen.",
      },
      name: { type: "string", description: "Layer name (made unique); also its C name" },
      text: { type: "string", description: "Its text, for labels, buttons and checkboxes" },
      ...layoutArgs,
      props: { type: "object", description: "Widget props by key; get_catalog lists them" },
      style: styleArg,
      index: {
        type: "number",
        description: "Position among the parent's children; default last (on top)",
      },
    },
    required: ["type"],
    run: a => {
      const p = project()
      const type = str(a, "type", true) as WidgetType
      if (!INSERTABLE.includes(type)) throw new ToolError(`type is one of ${INSERTABLE.join(", ")}`)
      const parentRef = str(a, "parent")
      const parent = parentRef ? layerRef(p, parentRef) : screenRef(p, undefined)
      if (!canContain(parent))
        throw new ToolError(`${parent.name} is a ${parent.widget}, which can't hold widgets`)
      const node = createNode(type, {
        name: uniqueName(p, str(a, "name") ?? WIDGETS[type].label),
      })
      const [pw, ph] = [parent.layout.w, parent.layout.h]
      const [w, h] = [node.layout.w, node.layout.h]
      if (!parent.layout.flex) {
        if (typeof w === "number" && typeof h === "number") {
          node.layout.x = typeof pw === "number" ? Math.round((pw - w) / 2) : 10
          node.layout.y = typeof ph === "number" ? Math.round((ph - h) / 2) : 10
        } else node.layout.align = "LV_ALIGN_CENTER"
      }
      setLayout(node, a)
      if (a.props) setProps(node, obj(a, "props")!)
      if (a.text != null) setText(node, str(a, "text")!)
      if (a.style) mergeStyle(node.style, obj(a, "style")!)
      edit(d => insertNode(d, parent.id, node, num(a, "index")))
      select([node.id])
      return json({ id: node.id, name: node.name })
    },
  },
  {
    name: "update_layer",
    title: "Change a layer",
    description:
      "Changes a layer (or a screen's name and style): layout, props, text, style (merged; null removes), flags, or where it sits (parent, index). One undo step.",
    properties: {
      layer: { type: "string", description: "Layer id or name" },
      name: { type: "string" },
      text: { type: "string" },
      ...layoutArgs,
      props: { type: "object", description: "Widget props to set; null resets one" },
      style: styleArg,
      hidden: { type: "boolean" },
      checked: { type: "boolean" },
      disabled: { type: "boolean" },
      parent: { type: "string", description: "Move it into this screen or container" },
      index: { type: "number", description: "Its position among the parent's children" },
    },
    required: ["layer"],
    run: a => {
      const p = project()
      const node = layerRef(p, str(a, "layer", true)!)
      const screen = node.widget === "screen"
      const name = str(a, "name")
      if (name && name !== node.name && allNodes(p).some(n => n.name === name))
        throw new ToolError(`Another layer is already called ${name}`)
      if (screen && ["x", "y", "w", "h", "align", "parent", "index"].some(k => a[k] != null))
        throw new ToolError("A screen is the size of the display; it doesn't move or resize")
      const parent = str(a, "parent")
      const target = parent ? layerRef(p, parent) : undefined
      if (target && !canContain(target))
        throw new ToolError(`${target.name} is a ${target.widget}, which can't hold widgets`)
      edit(d => {
        const n = locate(d, node.id)!.node
        if (name) n.name = name
        setLayout(n, a)
        if (a.props) setProps(n, obj(a, "props")!)
        if (a.text != null) setText(n, str(a, "text")!)
        if (a.style) mergeStyle(n.style, obj(a, "style")!)
        for (const k of ["hidden", "checked", "disabled"] as const) {
          const v = bool(a, k)
          if (v !== undefined) n[k] = v
        }
        if (target || a.index != null) {
          const into = target?.id ?? locate(d, node.id)!.parent!.id
          const at = num(a, "index") ?? locate(d, into)!.node.children.length
          moveNode(d, node.id, into, at)
        }
      })
      select([node.id])
      return text(`Updated ${name ?? node.name}`)
    },
  },
  {
    name: "delete_layers",
    title: "Delete layers",
    description:
      "Deletes layers (with their children) or screens. The last screen stays. The person can undo it in Kiln.",
    properties: {
      layers: { type: "array", items: { type: "string" }, description: "Ids or names" },
    },
    required: ["layers"],
    destructive: true,
    run: a => {
      const p = project()
      const nodes = arg<unknown[]>(a, "layers", "array", true)!.map(r => layerRef(p, String(r)))
      edit(d =>
        removeNodes(
          d,
          nodes.map(n => n.id),
        ),
      )
      select([])
      return text(`Deleted ${nodes.map(n => n.name).join(", ")}`)
    },
  },
  {
    name: "add_screen",
    title: "Add a screen",
    description: "Adds a screen to the right of the others, styled like the first. Returns its id.",
    properties: { name: { type: "string" } },
    run: a => {
      const p = project()
      const { width } = p.target.display
      const screen = createScreen(
        uniqueName(p, str(a, "name") ?? `Screen ${p.screens.length + 1}`),
        p.target.display,
        {
          x: Math.max(...p.screens.map(s => s.frame.x)) + width + 80,
          y: p.screens[0].frame.y,
        },
      )
      const first = realScreens(p)[0]
      if (first) screen.style = structuredClone(first.style)
      edit(d => void d.screens.push(screen))
      select([screen.id])
      return json({ id: screen.id, name: screen.name })
    },
  },
  {
    name: "add_variable",
    title: "Add a variable",
    description:
      "Adds a variable (an LVGL subject) that layers bind to: an int with a range, or a string. In Kiln it can be fed from a pin or simulated.",
    properties: {
      name: { type: "string", description: "A C identifier, like temperature" },
      type: { type: "string", enum: ["int", "string"] },
      initial: { type: ["number", "string"] },
      min: { type: "number" },
      max: { type: "number" },
    },
    required: ["name"],
    run: a => {
      const p = project()
      const name = str(a, "name", true)!
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw new ToolError("A variable's name is a C identifier: letters, digits and _")
      if (p.variables.some(v => v.name === name)) throw new ToolError(`There's already a ${name}`)
      const type = str(a, "type") === "string" ? "string" : "int"
      const v = createVariable(name, {
        type,
        initial: type === "string" ? String(a.initial ?? "") : Number(a.initial ?? 0),
        ...(num(a, "min") !== undefined && { min: num(a, "min")! }),
        ...(num(a, "max") !== undefined && { max: num(a, "max")! }),
      })
      edit(d => void d.variables.push(v))
      return json({ id: v.id, name: v.name })
    },
  },
  {
    name: "add_binding",
    title: "Bind a layer to a variable",
    description:
      'Binds a layer to a variable. kind "text" (format like "%d °C"), "value" (arc, bar, slider…), "checked", "series" (chart), "flag" (hide or make clickable when the variable compares to ref), "state" (add a state the same way), or "style" (map the variable from [inMin, inMax] to [outMin, outMax] onto a style prop).',
    properties: {
      layer: { type: "string" },
      kind: {
        type: "string",
        enum: ["text", "value", "checked", "series", "flag", "state", "style"],
      },
      variable: { type: "string", description: "Variable id or name" },
      format: { type: "string", description: "text: printf format" },
      flag: { type: "string", enum: BIND_FLAGS.map(o => o.value) },
      state: { type: "string", enum: BIND_STATES.map(o => o.value) },
      compare: { type: "string", enum: COMPARE.map(o => o.value) },
      ref: { type: "number" },
      prop: { type: "string", description: "style: the style property" },
      selector: { type: "string", description: 'style: default "main:default"' },
      inMin: { type: "number" },
      inMax: { type: "number" },
      outMin: { type: "number" },
      outMax: { type: "number" },
    },
    required: ["layer", "kind", "variable"],
    run: a => {
      const p = project()
      const node = layerRef(p, str(a, "layer", true)!)
      const v = variableRef(p, str(a, "variable", true)!)
      const kind = str(a, "kind", true)!
      const variable = v.id
      let binding: Binding
      switch (kind) {
        case "text":
          binding = { kind, variable, format: str(a, "format") ?? (v.type === "int" ? "%d" : "%s") }
          break
        case "value":
        case "checked":
        case "series":
          if (!WIDGETS[node.widget].bind.includes(kind))
            throw new ToolError(`A ${node.widget} doesn't take a ${kind} binding`)
          binding = { kind, variable }
          break
        case "flag":
          binding = {
            kind,
            variable,
            flag: oneOf(a.flag ?? "LV_OBJ_FLAG_HIDDEN", BIND_FLAGS, "flag"),
            compare: oneOf(a.compare ?? "eq", COMPARE, "compare") as Compare,
            ref: num(a, "ref") ?? 0,
          }
          break
        case "state":
          binding = {
            kind,
            variable,
            state: oneOf(a.state ?? "LV_STATE_CHECKED", BIND_STATES, "state"),
            compare: oneOf(a.compare ?? "eq", COMPARE, "compare") as Compare,
            ref: num(a, "ref") ?? 0,
          }
          break
        case "style": {
          const prop = str(a, "prop", true)!
          if (!STYLE_PROPS.some(s => s.name === prop))
            throw new ToolError(`There's no style property "${prop}"`)
          const selector = str(a, "selector") ?? "main:default"
          checkSelector(selector)
          const outMin = num(a, "outMin")
          const outMax = num(a, "outMax")
          if (outMin === undefined || outMax === undefined)
            throw new ToolError("A style binding needs outMin and outMax")
          binding = {
            kind,
            variable,
            prop,
            selector,
            inMin: num(a, "inMin") ?? v.min,
            inMax: num(a, "inMax") ?? v.max,
            outMin,
            outMax,
          }
          break
        }
        default:
          throw new ToolError("kind is text, value, checked, series, flag, state or style")
      }
      edit(d => void locate(d, node.id)!.node.bindings.push(binding))
      select([node.id])
      return text(`Bound ${node.name} to ${v.name}`)
    },
  },
  {
    name: "add_interaction",
    title: "Add an interaction",
    description:
      'What a layer does on an event (default a click): action {"type": "navigate", "screen", "anim"?, "duration"?}, {"type": "set", "variable", "value"}, {"type": "increment", "variable", "step"}, {"type": "toggle", "variable"} or {"type": "play", "animation", "reverse"?}.',
    properties: {
      layer: { type: "string" },
      trigger: { type: "string", enum: EVENTS.map(o => o.value) },
      action: { type: "object" },
    },
    required: ["layer", "action"],
    run: a => {
      const p = project()
      const node = layerRef(p, str(a, "layer", true)!)
      const trigger = oneOf(a.trigger ?? "LV_EVENT_CLICKED", EVENTS, "trigger")
      const act = obj(a, "action", true)!
      let action: Action
      switch (act.type) {
        case "navigate": {
          const to = screenRef(p, str(act, "screen", true))
          const from = screenOf(p, node.id)
          action = {
            type: "navigate",
            screen: to.id,
            anim: act.anim
              ? oneOf(act.anim, SCREEN_LOAD_ANIM, "anim")
              : to.frame.x >= (from?.frame.x ?? 0)
                ? "LV_SCREEN_LOAD_ANIM_MOVE_LEFT"
                : "LV_SCREEN_LOAD_ANIM_MOVE_RIGHT",
            duration: num(act, "duration") ?? 300,
            delay: num(act, "delay") ?? 0,
          }
          break
        }
        case "set":
          action = {
            type: "set",
            variable: variableRef(p, str(act, "variable", true)!).id,
            value: num(act, "value") ?? 0,
          }
          break
        case "increment":
          action = {
            type: "increment",
            variable: variableRef(p, str(act, "variable", true)!).id,
            step: num(act, "step") ?? 1,
          }
          break
        case "toggle":
          action = { type: "toggle", variable: variableRef(p, str(act, "variable", true)!).id }
          break
        case "play": {
          const ref = str(act, "animation", true)!
          const anim = p.animations.find(x => x.id === ref || x.name === ref)
          if (!anim) throw new ToolError(`There's no animation "${ref}"`)
          action = {
            type: "play",
            animation: anim.id,
            reverse: bool(act, "reverse") ?? false,
            delay: num(act, "delay") ?? 0,
          }
          break
        }
        default:
          throw new ToolError("action.type is navigate, set, increment, toggle or play")
      }
      edit(d => void locate(d, node.id)!.node.events.push({ id: newId(), trigger, action }))
      select([node.id])
      return text(`${node.name} now does ${action.type} on ${trigger}`)
    },
  },
  {
    name: "new_project",
    title: "Start a project",
    description: `Opens a new project in a Kiln tab, on the person's board. template: ${TEMPLATES.map(t => t.value).join(", ")}.`,
    properties: {
      name: { type: "string" },
      template: { type: "string", enum: TEMPLATES.map(t => t.value) },
    },
    run: a => {
      const template = str(a, "template") ?? "blank"
      if (!TEMPLATES.some(t => t.value === template))
        throw new ToolError(`template is one of ${TEMPLATES.map(t => t.value).join(", ")}`)
      newProject(template)
      const name = str(a, "name")
      if (name) edit(d => void (d.name = name))
      return TOOLS[0].run({})
    },
  },
  {
    name: "build",
    title: "Build (and flash)",
    description:
      "Exports the project and runs PlatformIO in the background; with flash, uploads it to the board too, after the person says yes in Kiln. Returns at once: follow it with build_status.",
    properties: { flash: { type: "boolean" } },
    run: async a => {
      const p = project()
      needsDesktop()
      if (deviceStore.getState().job?.running)
        throw new ToolError("A build is already running; follow it with build_status")
      const flash = bool(a, "flash") ?? false
      if (flash) {
        const port = deviceStore.getState().port
        const ok = await confirmAction(
          `An AI assistant wants to build “${p.name}” and flash it to the board${port ? ` on ${port}` : ""}. Allow it?`,
        )
        if (!ok) throw new ToolError("The person said no to flashing")
      }
      if (!exportFolder()) {
        void build(flash)
        return text(
          "Kiln is asking the person where to put the PlatformIO project; the build starts once they pick a folder. Follow it with build_status.",
        )
      }
      await build(flash)
      const failed = editorApi.getState().error
      if (!deviceStore.getState().job?.running && failed) throw new ToolError(failed)
      return text(
        `${flash ? "Building and flashing" : "Building"} in the background. Follow it with build_status; a first build takes a few minutes.`,
      )
    },
  },
  {
    name: "build_status",
    title: "Follow the build",
    description:
      "The running or last build: running, succeeded, failed or stopped, its exit code, and the end of its log. wait_seconds (up to 30) waits for it to finish first.",
    properties: {
      wait_seconds: { type: "number" },
      lines: { type: "number", description: "Log lines to return (default 40)" },
    },
    readOnly: true,
    run: async a => {
      needsDesktop()
      const wait = clamp(num(a, "wait_seconds") ?? 0, 0, 30)
      if (wait) await until(() => !deviceStore.getState().job?.running, wait * 1000)
      const { job, log, progress, startedAt, finishedAt } = deviceStore.getState()
      if (!job) return text("Nothing has been built since Kiln opened.")
      const state = job.running
        ? "running"
        : job.stopped
          ? "stopped"
          : job.code === 0
            ? "succeeded"
            : "failed"
      return json({
        kind: job.kind,
        state,
        exitCode: job.code,
        port: job.port,
        ...(progress !== null && { uploadProgress: progress }),
        ...(startedAt && { seconds: Math.round(((finishedAt ?? Date.now()) - startedAt) / 1000) }),
        log: log.slice(-clamp(num(a, "lines") ?? 40, 1, 400)).map(stripAnsi),
      })
    },
  },
  {
    name: "read_serial",
    title: "Read the serial monitor",
    description:
      "What the board printed lately (the firmware logs there, and LVGL's warnings too), and the monitor's state. open: start the monitor if it's closed.",
    properties: {
      lines: { type: "number", description: "Lines to return (default 50)" },
      open: { type: "boolean" },
    },
    readOnly: true,
    run: async a => {
      needsDesktop()
      const status = () => deviceStore.getState().monitor?.status ?? "closed"
      if (bool(a, "open") && status() === "closed") {
        await openMonitor()
        await until(() => status() === "connected", 3000)
      }
      const { monitor, lines, partial } = deviceStore.getState()
      return json({
        status: status(),
        ...(monitor && { port: monitor.port, baud: monitor.baud }),
        ...(monitor?.error && { error: monitor.error }),
        lines: [...lines, ...(partial ? [partial] : [])]
          .slice(-clamp(num(a, "lines") ?? 50, 1, 1000))
          .map(stripAnsi),
      })
    },
  },
]

/** The tool list as MCP's tools/list gives it. */
export const toolList = () =>
  TOOLS.map(t => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: {
      type: "object",
      properties: t.properties,
      ...(t.required && { required: t.required }),
    },
    annotations: {
      title: t.title,
      readOnlyHint: Boolean(t.readOnly),
      destructiveHint: Boolean(t.destructive),
      openWorldHint: false,
    },
  }))

/** Runs a tool; whatever goes wrong comes back as a result the model can read. */
export async function callTool(name: string, args: Args = {}): Promise<ToolResult> {
  const tool = TOOLS.find(t => t.name === name)
  if (!tool) return { content: [{ type: "text", text: `There's no tool ${name}` }], isError: true }
  try {
    return await tool.run(args)
  } catch (e) {
    return {
      content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
      isError: true,
    }
  }
}
