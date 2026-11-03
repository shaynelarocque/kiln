import {
  ANIM_PROPS,
  WIDGETS,
  bool,
  c,
  call,
  easingPath,
  int,
  obj,
  selectorConsts,
  str,
  styleProp,
  stylePropConst,
  transitionPath,
  type AnimProp,
  type Arg,
  type Coord,
  type Easing,
  type Op,
  type Program,
  type WidgetDef,
} from "@/shared/lvgl"
import { resolveScreens } from "../model/components"
import type { Animation, Binding, Interaction, Node, Project, StyleValue } from "../model/types"
import { cNames } from "./names"
import { findNode, screenOf, walk } from "./tree"

/** edit: per-screen preview, no events or timelines. play: everything. export: play minus demo data. */
export type CompileMode = "edit" | "play" | "export"

const IMAGE_CF = { RGB565: "LV_COLOR_FORMAT_RGB565", RGB565A8: "LV_COLOR_FORMAT_RGB565A8", ARGB8888: "LV_COLOR_FORMAT_ARGB8888" }

const VALUE_BINDERS: Partial<Record<string, string>> = {
  arc: "lv_arc_bind_value",
  bar: "lv_bar_bind_value",
  slider: "lv_slider_bind_value",
  roller: "lv_roller_bind_value",
  dropdown: "lv_dropdown_bind_value",
}

const COMPARE: Record<string, string> = { eq: "KILN_EQ", not_eq: "KILN_NOT_EQ", gt: "KILN_GT", ge: "KILN_GE", lt: "KILN_LT", le: "KILN_LE" }

const coord = (v: Coord): Arg => ({ k: "coord", v })
const hex = (v: string | number): Arg => ({ k: "hex", v: parseInt(String(v).replace("#", ""), 16) || 0 })

/** A printf format with exactly one conversion that suits the variable, or null (LVGL then prints the bare value). */
export function safeFormat(format: string, type: "int" | "string"): string | null {
  const specs = format.replace(/%%/g, "").match(/%[-+ 0#]*\d*(?:\.\d+)?[a-zA-Z]/g) ?? []
  if (specs.length !== 1) return null
  const conv = specs[0].slice(-1)
  return (type === "int" ? "diuxX" : "s").includes(conv) ? format : null
}

/** Mirror a curve for the return leg of an alternating animation (ease-in plays back as ease-out). */
function reversed(easing: Easing) {
  const { path, bezier } = easingPath(easing)
  if (!bezier) return { path }
  const [x1, y1, x2, y2] = bezier
  return { path, bezier: [1024 - x2, 1024 - y2, 1024 - x1, 1024 - y1] }
}

export function compile(source: Project, mode: CompileMode): Program {
  // Instances expand into plain widgets; the Components screen is only built for the canvas.
  const project = { ...source, screens: resolveScreens(source, mode === "edit") }
  const names = cNames(project)

  const styleArg = (prop: string, value: StyleValue): Arg | null => {
    switch (styleProp(prop)?.type) {
      case "color": {
        const v = String(value)
        if (!v.startsWith("$")) return { k: "color", v }
        const token = project.tokens.find(t => t.id === v.slice(1))
        return token ? { k: "color", v: token.value, token: names[token.id] } : null
      }
      case "font":
        return { k: "font", name: String(value) }
      case "enum":
        return c(String(value))
      case "bool":
        return bool(Boolean(value))
      case "image":
        return project.assets.some(a => a.id === value) ? { k: "image", id: String(value) } : null
      default:
        return typeof value === "number" ? int(value) : null
    }
  }

  const propArg = (def: WidgetDef, key: string, value: unknown): Arg | null => {
    if (value === null || value === undefined) return null
    switch (def.props.find(p => p.key === key)?.type) {
      case "text":
      case "lines":
        return str(String(value))
      case "enum":
        return c(String(value))
      case "bool":
        return bool(Boolean(value))
      case "color":
        return { k: "color", v: String(value) }
      case "image":
        return project.assets.some(a => a.id === value) ? { k: "image", id: String(value) } : null
      default:
        return int(Number(value))
    }
  }

  const bindingOp = (node: Node, b: Binding): Op | null => {
    const variable = project.variables.find(v => v.id === b.variable)
    if (!variable) return null
    const o = obj(node.id)
    const s: Arg = { k: "subject", id: variable.id }
    switch (b.kind) {
      case "text": {
        if (node.widget !== "label") return null
        const format = safeFormat(b.format, variable.type)
        return call("lv_label_bind_text", o, s, format ? str(format) : { k: "null" })
      }
      case "value": {
        const fn = VALUE_BINDERS[node.widget]
        return fn && variable.type === "int" ? call(fn, o, s) : null
      }
      case "checked":
        return variable.type === "int" ? call("lv_obj_bind_checked", o, s) : null
      case "series":
        return node.widget === "chart" && variable.type === "int"
          ? call("kiln_chart_bind_series", o, { k: "series", id: `${node.id}.series` }, s)
          : null
      case "flag":
        return call("kiln_bind_flag_if", o, s, c(b.flag), c(COMPARE[b.compare]), int(b.ref))
      case "state":
        return call("kiln_bind_state_if", o, s, c(b.state), c(COMPARE[b.compare]), int(b.ref))
      case "style": {
        const prop = c(stylePropConst(b.prop))
        const sel = c(...selectorConsts(b.selector))
        if (b.inMin === b.outMin && b.inMax === b.outMax) return call("lv_obj_bind_style_prop", o, prop, sel, s)
        return call("kiln_bind_style_map", o, prop, sel, s, int(b.inMin), int(b.inMax), int(b.outMin), int(b.outMax))
      }
    }
  }

  const nodeOps = (node: Node, parent: string | null, ops: Op[]) => {
    const def = WIDGETS[node.widget]
    const o = obj(node.id)
    ops.push({ op: "create", id: node.id, fn: def.create, parent })

    if (parent) {
      const { x, y, w, h, align } = node.layout
      if (align !== "LV_ALIGN_TOP_LEFT") ops.push(call("lv_obj_align", o, c(align), coord(x), coord(y)))
      else if (x !== 0 || y !== 0) ops.push(call("lv_obj_set_pos", o, coord(x), coord(y)))
      ops.push(call("lv_obj_set_size", o, coord(w), coord(h)))
    }
    const flex = node.layout.flex
    if (flex)
      ops.push(
        call("lv_obj_set_flex_flow", o, c(flex.flow)),
        call("lv_obj_set_flex_align", o, c(flex.main), c(flex.cross), c(flex.track)),
      )
    if (node.layout.grow) ops.push(call("lv_obj_set_flex_grow", o, int(node.layout.grow)))

    for (const wc of def.calls) {
      const args = wc.args.map(a => (typeof a === "string" ? propArg(def, a, node.props[a]) : a))
      if (args.every(a => a !== null)) ops.push(call(wc.fn, o, ...(args as Arg[])))
    }
    if (node.widget === "chart") {
      const series: Arg = { k: "series", id: `${node.id}.series` }
      ops.push({
        op: "call",
        fn: "lv_chart_add_series",
        args: [o, { k: "color", v: String(node.props.seriesColor ?? "#2196f3") }, c("LV_CHART_AXIS_PRIMARY_Y")],
        ret: { kind: "series", id: `${node.id}.series` },
      })
      // Something to look at while designing; a bound series fills from its variable instead.
      if (mode !== "export" && !node.bindings.some(b => b.kind === "series")) {
        const [lo, hi, n] = [Number(node.props.min), Number(node.props.max), Number(node.props.points)]
        for (let i = 0; i < n; i++)
          ops.push(call("lv_chart_set_next_value", o, series, int(lo + ((hi - lo) * (1 + Math.sin(i / 2.2))) / 2.2)))
      }
    }

    // LVGL 9.6 setters; lv_obj_add_flag and friends are deprecated
    if (node.hidden) ops.push(call("lv_obj_set_hidden", o, bool(true)))
    if ((node.widget === "container" || node.widget === "screen") && !node.scrollable) ops.push(call("lv_obj_set_scrollable", o, bool(false)))
    if (node.checkable) ops.push(call("lv_obj_set_checkable", o, bool(true)))
    if (node.clickable !== undefined) ops.push(call("lv_obj_set_clickable", o, bool(node.clickable)))
    if (node.checked) ops.push(call("lv_obj_set_checked", o, bool(true)))
    if (node.disabled) ops.push(call("lv_obj_set_disabled", o, bool(true)))

    for (const cls of node.classes)
      if (project.styles.some(s => s.id === cls.style))
        ops.push(call("lv_obj_add_style", o, { k: "style", id: cls.style }, c(...selectorConsts(cls.selector))))
    for (const [selector, props] of Object.entries(node.style))
      for (const [prop, value] of Object.entries(props)) {
        const v = styleArg(prop, value)
        if (v) ops.push(call(`lv_obj_set_style_${prop}`, o, v, c(...selectorConsts(selector))))
      }

    // LVGL looks the transition up in the state being entered, so every part/state pair needs it.
    if (node.transition?.props.length) {
      const pairs = new Set<string>()
      const parts = new Set(["main", ...Object.keys(node.style).map(k => k.split(":")[0])])
      for (const part of parts) for (const st of ["default", "pressed", "checked"]) pairs.add(`${part}:${st}`)
      for (const key of Object.keys(node.style)) pairs.add(key)
      for (const pair of pairs)
        ops.push(call("lv_obj_set_style_transition", o, { k: "transition", id: `${node.id}.tr` }, c(...selectorConsts(pair))))
    }

    for (const b of node.bindings) {
      const op = bindingOp(node, b)
      if (op) ops.push(op)
    }
    for (const child of node.children) nodeOps(child, node.id, ops)
  }

  const setup: Op[] = []
  for (const a of project.assets)
    setup.push({ op: "image", id: a.id, cf: IMAGE_CF[a.format], w: a.width, h: a.height, stride: a.stride, data: fromBase64(a.data) })
  for (const v of project.variables)
    setup.push(
      v.type === "int"
        ? { op: "subject", id: v.id, type: "int", init: clamp(Number(v.initial), v.min, v.max), min: Math.min(v.min, v.max), max: Math.max(v.min, v.max) }
        : { op: "subject", id: v.id, type: "string", init: String(v.initial) },
    )
  for (const s of project.styles) {
    setup.push({ op: "style", id: s.id })
    for (const [prop, value] of Object.entries(s.props)) {
      const v = styleArg(prop, value)
      if (v) setup.push(call(`lv_style_set_${prop}`, { k: "style", id: s.id }, v))
    }
  }
  for (const screen of project.screens)
    walk(screen, n => {
      const t = n.transition
      if (t?.props.length)
        setup.push({ op: "transition", id: `${n.id}.tr`, props: t.props.map(stylePropConst), path: transitionPath(t.easing), time: t.duration, delay: t.delay })
    })

  const screens = project.screens.map(screen => {
    const ops: Op[] = []
    nodeOps(screen, null, ops)
    return { id: screen.id, ops }
  })

  return { names, setup, screens, wiring: mode === "edit" ? [] : wiringOps(project) }
}

function clamp(v: number, a: number, b: number) {
  return Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b))
}

function fromBase64(data: string) {
  return Uint8Array.from(atob(data), ch => ch.charCodeAt(0))
}

function segmentOps(nodeId: string, prop: AnimProp, start: number, from: StyleValue, to: StyleValue, duration: number, easing: { path: string; bezier?: number[] }, timeline: Arg): Op[] {
  const a: Arg = { k: "anim" }
  const drive = prop.drive
  const ops: Op[] = [call("lv_anim_init", a), call("lv_anim_set_var", a, obj(nodeId))]
  if ("color" in drive) ops.push(call("kiln_anim_set_color", a, c(drive.color), hex(String(from)), hex(String(to))))
  else {
    if ("exec" in drive) ops.push(call("lv_anim_set_exec_cb", a, { k: "fn", name: drive.exec, cast: "lv_anim_exec_xcb_t" }))
    else if ("style" in drive) ops.push(call("kiln_anim_set_style", a, c(drive.style)))
    else ops.push(call("kiln_anim_set_scale", a))
    ops.push(call("lv_anim_set_values", a, int(Number(from)), int(Number(to))))
  }
  ops.push(call("lv_anim_set_duration", a, int(duration)), call("lv_anim_set_path_cb", a, { k: "fn", name: easing.path }))
  if (easing.bezier) ops.push(call("lv_anim_set_bezier3_param", a, ...easing.bezier.map(int)))
  ops.push(call("lv_anim_timeline_add", timeline, int(start), a))
  return ops
}

function timelineOps(project: Project, anim: Animation): Op[] {
  const tracks = anim.tracks.filter(t => t.keyframes.length >= 2 && findNode(project, t.node))
  if (!tracks.length) return []
  const tl: Arg = { k: "timeline", id: anim.id }
  const ops: Op[] = [{ op: "call", fn: "lv_anim_timeline_create", args: [], ret: { kind: "timeline", id: anim.id } }]
  const end = Math.max(...tracks.flatMap(t => t.keyframes.map(k => k.t)))
  for (const track of tracks) {
    const prop = ANIM_PROPS.find(p => p.value === track.prop)
    if (!prop) continue
    const kf = [...track.keyframes].sort((a, b) => a.t - b.t)
    for (let i = 0; i < kf.length - 1; i++) {
      const duration = kf[i + 1].t - kf[i].t
      ops.push(...segmentOps(track.node, prop, kf[i].t, kf[i].value, kf[i + 1].value, duration, easingPath(kf[i].easing), tl))
      // alternate: play the same segment backwards, mirrored around the end of the timeline
      if (anim.alternate)
        ops.push(...segmentOps(track.node, prop, 2 * end - kf[i + 1].t, kf[i + 1].value, kf[i].value, duration, reversed(kf[i].easing), tl))
    }
  }
  if (anim.repeat) ops.push(call("lv_anim_timeline_set_repeat_count", tl, anim.repeat < 0 ? c("LV_ANIM_REPEAT_INFINITE") : int(anim.repeat)))
  if (anim.delay) ops.push(call("lv_anim_timeline_set_delay", tl, int(anim.delay)))
  const screen = screenOf(project, tracks[0].node)
  if (anim.autoplay && screen)
    ops.push(call("lv_obj_add_play_timeline_event", obj(screen.id), c("LV_EVENT_SCREEN_LOADED"), tl, int(0), bool(false)))
  return ops
}

function actionOp(project: Project, node: Node, ev: Interaction): Op | null {
  const o = obj(node.id)
  const trigger = c(ev.trigger)
  const a = ev.action
  const subject = (id: string): Arg | null => (project.variables.some(v => v.id === id && v.type === "int") ? { k: "subject", id } : null)
  switch (a.type) {
    case "navigate":
      return project.screens.some(s => s.id === a.screen) && a.screen !== node.id
        ? call("lv_obj_add_screen_load_event", o, trigger, obj(a.screen), c(a.anim), int(a.duration), int(a.delay))
        : null
    case "set": {
      const s = subject(a.variable)
      return s && call("lv_obj_add_subject_set_int_event", o, s, trigger, int(a.value))
    }
    case "increment": {
      const s = subject(a.variable)
      return s && call("lv_obj_add_subject_increment_event", o, s, trigger, int(a.step))
    }
    case "toggle": {
      const s = subject(a.variable)
      return s && call("lv_obj_add_subject_toggle_event", o, s, trigger)
    }
    case "play": {
      const anim = project.animations.find(x => x.id === a.animation)
      return anim && timelineOps(project, anim).length
        ? call("lv_obj_add_play_timeline_event", o, trigger, { k: "timeline", id: anim.id }, int(a.delay), bool(a.reverse))
        : null
    }
  }
}

function wiringOps(project: Project): Op[] {
  const ops = project.animations.flatMap(anim => timelineOps(project, anim))
  for (const screen of project.screens)
    walk(screen, node => {
      for (const ev of node.events) {
        const op = actionOp(project, node, ev)
        if (op) ops.push(op)
      }
    })
  return ops
}
