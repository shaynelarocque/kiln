import {
  ALIGN,
  ANIM_PROPS,
  BIND_FLAGS,
  BIND_STATES,
  EVENTS,
  FLEX_ALIGN,
  FLEX_FLOW,
  FONTS,
  SCREEN_LOAD_ANIM,
  TRANSITION_PROPS,
  TTF_GLYPH_CACHE,
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
import { instancesOf, resolveScreens } from "../model/components"
import type { Animation, Binding, Interaction, Node, Project, StyleValue } from "../model/types"
import { ttfFallbacks, ttfUses } from "./fonts"
import { cNames } from "./names"
import { screenOf, walk } from "./tree"

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

/*
 * Everything below ends up as C source, and project files can come from anywhere: values are
 * checked against what Kiln itself would write (catalog enums, #rrggbb colours, finite numbers),
 * and anything else is dropped rather than printed.
 */
const HEX = /^#[0-9a-f]{6}$/i
const FONT_NAMES = new Set(FONTS.map(f => f.value))
const ALIGNS = new Set(["LV_ALIGN_DEFAULT", ...ALIGN.map(a => a.value)])
const known = (options: { value: string }[] | undefined, v: unknown) => Boolean(options?.some(o => o.value === v))
const finite = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Widgets whose min/max feed a division in LVGL: min must stay below max. */
const RANGED = new Set(["arc", "bar", "slider", "scale", "chart"])

const coord = (v: Coord): Arg => ({
  k: "coord",
  v: typeof v === "number" ? finite(v) : v === "content" || /^-?\d+(\.\d+)?%$/.test(String(v)) ? v : 0,
})
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
  // imported fonts whose bytes decode; styles naming any other ttf: value keep the default font
  const ttfData = new Map<string, Uint8Array>()
  for (const f of project.fonts) {
    const data = fromBase64(f.data)
    if (data?.length) ttfData.set(f.id, data)
  }
  const ttfFonts = ttfUses(project).filter(u => ttfData.has(u.id))

  const styleArg = (prop: string, value: StyleValue): Arg | null => {
    const def = styleProp(prop)
    if (!def) return null
    switch (def.type) {
      case "color": {
        const v = String(value)
        if (!v.startsWith("$")) return HEX.test(v) ? { k: "color", v } : null
        const token = project.tokens.find(t => t.id === v.slice(1))
        return token && HEX.test(token.value) ? { k: "color", v: token.value, token: names[token.id] } : null
      }
      case "font": {
        if (FONT_NAMES.has(String(value))) return { k: "font", name: String(value) }
        const f = ttfFonts.find(u => value === `ttf:${u.id}:${u.size}`)
        return f ? { k: "tiny_ttf", id: `${f.id}@${f.size}` } : null
      }
      case "enum":
        return known(def.options, value) ? c(String(value)) : null
      case "bool":
        return bool(Boolean(value))
      case "image":
        return project.assets.some(a => a.id === value) ? { k: "image", id: String(value) } : null
      default:
        return typeof value === "number" && Number.isFinite(value) ? int(value) : null
    }
  }

  const propArg = (def: WidgetDef, key: string, value: unknown): Arg | null => {
    if (value === null || value === undefined) return null
    const prop = def.props.find(p => p.key === key)
    switch (prop?.type) {
      case "text":
      case "lines":
        return str(String(value))
      case "enum":
        return known(prop.options, value) ? c(String(value)) : null
      case "bool":
        return bool(Boolean(value))
      case "color":
        return HEX.test(String(value)) ? { k: "color", v: String(value) } : null
      case "image":
        return project.assets.some(a => a.id === value) ? { k: "image", id: String(value) } : null
      default:
        return int(finite(value))
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
        return known(BIND_FLAGS, b.flag) && COMPARE[b.compare]
          ? call("kiln_bind_flag_if", o, s, c(b.flag), c(COMPARE[b.compare]), int(finite(b.ref)))
          : null
      case "state":
        return known(BIND_STATES, b.state) && COMPARE[b.compare]
          ? call("kiln_bind_state_if", o, s, c(b.state), c(COMPARE[b.compare]), int(finite(b.ref)))
          : null
      case "style": {
        if (!styleProp(b.prop)) return null
        const prop = c(stylePropConst(b.prop))
        const sel = c(...selectorConsts(b.selector))
        if (b.inMin === b.outMin && b.inMax === b.outMax) return call("lv_obj_bind_style_prop", o, prop, sel, s)
        return call("kiln_bind_style_map", o, prop, sel, s, ...[b.inMin, b.inMax, b.outMin, b.outMax].map(v => int(finite(v))))
      }
    }
  }

  const nodeOps = (node: Node, parent: string | null, ops: Op[]) => {
    const def = WIDGETS[node.widget]
    const o = obj(node.id)
    ops.push({ op: "create", id: node.id, fn: def.create, parent })

    if (parent) {
      const { x, y, w, h } = node.layout
      const align = ALIGNS.has(node.layout.align) ? node.layout.align : "LV_ALIGN_TOP_LEFT"
      if (align !== "LV_ALIGN_TOP_LEFT") ops.push(call("lv_obj_align", o, c(align), coord(x), coord(y)))
      else if (x !== 0 || y !== 0) ops.push(call("lv_obj_set_pos", o, coord(x), coord(y)))
      ops.push(call("lv_obj_set_size", o, coord(w), coord(h)))
    }
    const flex = node.layout.flex
    if (flex && known(FLEX_FLOW, flex.flow) && [flex.main, flex.cross, flex.track].every(v => known(FLEX_ALIGN, v)))
      ops.push(
        call("lv_obj_set_flex_flow", o, c(flex.flow)),
        call("lv_obj_set_flex_align", o, c(flex.main), c(flex.cross), c(flex.track)),
      )
    if (node.layout.grow) ops.push(call("lv_obj_set_flex_grow", o, int(finite(node.layout.grow))))

    // LVGL divides by (max - min) when you drag an arc or slider: keep the range non-empty
    const props = { ...node.props }
    if (RANGED.has(node.widget) && finite(props.max) <= finite(props.min)) props.max = finite(props.min) + 1
    for (const wc of def.calls) {
      const args = wc.args.map(a => (typeof a === "string" ? propArg(def, a, props[a]) : a))
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
        const [lo, hi, n] = [finite(props.min), finite(props.max), Math.min(400, finite(props.points))]
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
    if (node.transition?.props.some(p => TRANSITION_PROPS.includes(p))) {
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
  for (const id of new Set(ttfFonts.map(u => u.id))) setup.push({ op: "ttf", id, data: ttfData.get(id)! })
  const fallbacks = ttfFallbacks(project)
  for (const u of ttfFonts)
    setup.push({ op: "tiny_ttf", id: `${u.id}@${u.size}`, ttf: u.id, size: u.size, cache: TTF_GLYPH_CACHE, fallback: fallbacks.get(`ttf:${u.id}:${u.size}`) ?? null })
  for (const a of project.assets) {
    const data = a.format in IMAGE_CF ? fromBase64(a.data) : null
    if (data) setup.push({ op: "image", id: a.id, cf: IMAGE_CF[a.format], w: finite(a.width), h: finite(a.height), stride: finite(a.stride), data })
  }
  for (const v of project.variables)
    setup.push(
      v.type === "int"
        ? { op: "subject", id: v.id, type: "int", init: clamp(finite(v.initial), finite(v.min), finite(v.max)), min: Math.min(finite(v.min), finite(v.max)), max: Math.max(finite(v.min), finite(v.max)) }
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
      const props = t?.props.filter(p => TRANSITION_PROPS.includes(p)) ?? []
      if (t && props.length)
        setup.push({ op: "transition", id: `${n.id}.tr`, props: props.map(stylePropConst), path: transitionPath(t.easing), time: finite(t.duration), delay: finite(t.delay) })
    })

  const screens = project.screens.map(screen => {
    const ops: Op[] = []
    nodeOps(screen, null, ops)
    return { id: screen.id, ops }
  })

  return { names, setup, screens, wiring: mode === "edit" ? [] : wiringOps(project, trackTargets(source, project)) }
}

function clamp(v: number, a: number, b: number) {
  return Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b))
}

function fromBase64(data: string) {
  try {
    return Uint8Array.from(atob(data), ch => ch.charCodeAt(0))
  } catch {
    return null
  }
}

type Segment = { start: number; from: StyleValue; to: StyleValue; duration: number; easing: { path: string; bezier?: number[] } }

function segmentOps(nodeId: string, prop: AnimProp, seg: Segment, first: boolean, timeline: Arg): Op[] {
  const a: Arg = { k: "anim" }
  const drive = prop.drive
  const { start, from, to, duration, easing } = seg
  const ops: Op[] = [call("lv_anim_init", a), call("lv_anim_set_var", a, obj(nodeId))]
  // a pending segment would otherwise keep re-applying its start value over the one that's playing
  if (!first) ops.push(call("lv_anim_set_early_apply", a, bool(false)))
  if ("color" in drive) ops.push(call("kiln_anim_set_color", a, c(drive.color), hex(String(from)), hex(String(to))))
  else {
    if ("exec" in drive) ops.push(call("lv_anim_set_exec_cb", a, { k: "fn", name: drive.exec, cast: "lv_anim_exec_xcb_t" }))
    else if ("style" in drive) ops.push(call("kiln_anim_set_style", a, c(drive.style)))
    else ops.push(call("kiln_anim_set_scale", a))
    ops.push(call("lv_anim_set_values", a, int(finite(from)), int(finite(to))))
  }
  ops.push(call("lv_anim_set_duration", a, int(duration)), call("lv_anim_set_path_cb", a, { k: "fn", name: easing.path }))
  if (easing.bezier) ops.push(call("lv_anim_set_bezier3_param", a, ...easing.bezier.map(int)))
  ops.push(call("lv_anim_timeline_add", timeline, int(start), a))
  return ops
}

/** Node ids a track's node maps to once instances are expanded (see trackTargets). */
type Targets = (nodeId: string) => string[]

/**
 * Where an animated node ends up in the built UI: the node itself (unless it sits on the
 * Components screen, which isn't built), its copies inside instances (ids ending in /<id>),
 * and, for a main component, every instance of it, nested ones included.
 */
function trackTargets(source: Project, resolved: Project): Targets {
  const ids: string[] = []
  for (const s of resolved.screens) walk(s, n => void ids.push(n.id))
  return nodeId => {
    const from = [nodeId, ...instancesOf(source, nodeId).map(i => i.id)]
    return ids.filter(id => from.some(f => id === f || id.endsWith(`/${f}`)))
  }
}

function timelineOps(project: Project, anim: Animation, targets: Targets): Op[] {
  // one track per node it lands on, each with its own segments
  const tracks = anim.tracks.flatMap(t => (t.keyframes.length >= 2 ? targets(t.node).map(node => ({ ...t, node })) : []))
  if (!tracks.length) return []
  const tl: Arg = { k: "timeline", id: anim.id }
  const ops: Op[] = [{ op: "call", fn: "lv_anim_timeline_create", args: [], ret: { kind: "timeline", id: anim.id } }]
  const end = Math.max(...tracks.flatMap(t => t.keyframes.map(k => finite(k.t))))
  for (const track of tracks) {
    const prop = ANIM_PROPS.find(p => p.value === track.prop)
    if (!prop) continue
    const kf = [...track.keyframes].map(k => ({ ...k, t: finite(k.t) })).sort((a, b) => a.t - b.t)
    const segments: Segment[] = []
    for (let i = 0; i < kf.length - 1; i++) {
      const duration = kf[i + 1].t - kf[i].t
      segments.push({ start: kf[i].t, from: kf[i].value, to: kf[i + 1].value, duration, easing: easingPath(kf[i].easing) })
      // alternate: play the same segment backwards, mirrored around the end of the timeline
      if (anim.alternate) segments.push({ start: 2 * end - kf[i + 1].t, from: kf[i + 1].value, to: kf[i].value, duration, easing: reversed(kf[i].easing) })
    }
    segments.sort((a, b) => a.start - b.start)
    segments.forEach((seg, i) => ops.push(...segmentOps(track.node, prop, seg, i === 0, tl)))
  }
  if (anim.repeat) ops.push(call("lv_anim_timeline_set_repeat_count", tl, anim.repeat < 0 ? c("LV_ANIM_REPEAT_INFINITE") : int(finite(anim.repeat))))
  const screen = screenOf(project, tracks[0].node)
  if (anim.autoplay && screen)
    ops.push(call("kiln_obj_add_play_event", obj(screen.id), c("LV_EVENT_SCREEN_LOADED"), tl, int(finite(anim.delay)), bool(false)))
  return ops
}

function actionOp(project: Project, node: Node, ev: Interaction, timelines: Map<string, Op[]>): Op | null {
  if (!known(EVENTS, ev.trigger)) return null
  const o = obj(node.id)
  const trigger = c(ev.trigger)
  const a = ev.action
  const subject = (id: string): Arg | null => (project.variables.some(v => v.id === id && v.type === "int") ? { k: "subject", id } : null)
  switch (a.type) {
    case "navigate":
      return project.screens.some(s => s.id === a.screen) && a.screen !== node.id && known(SCREEN_LOAD_ANIM, a.anim)
        ? call("lv_obj_add_screen_load_event", o, trigger, obj(a.screen), c(a.anim), int(finite(a.duration)), int(finite(a.delay)))
        : null
    case "set": {
      const s = subject(a.variable)
      return s && call("lv_obj_add_subject_set_int_event", o, s, trigger, int(finite(a.value)))
    }
    case "increment": {
      const s = subject(a.variable)
      return s && call("lv_obj_add_subject_increment_event", o, s, trigger, int(finite(a.step)))
    }
    case "toggle": {
      const s = subject(a.variable)
      return s && call("lv_obj_add_subject_toggle_event", o, s, trigger)
    }
    case "play": {
      const anim = project.animations.find(x => x.id === a.animation)
      return anim && timelines.get(anim.id)?.length
        ? call("kiln_obj_add_play_event", o, trigger, { k: "timeline", id: anim.id }, int(finite(a.delay)), bool(Boolean(a.reverse)))
        : null
    }
  }
}

function wiringOps(project: Project, targets: Targets): Op[] {
  const timelines = new Map(project.animations.map(anim => [anim.id, timelineOps(project, anim, targets)]))
  const ops = [...timelines.values()].flat()
  for (const screen of project.screens)
    walk(screen, node => {
      for (const ev of node.events) {
        const op = actionOp(project, node, ev, timelines)
        if (op) ops.push(op)
      }
    })
  return ops
}
