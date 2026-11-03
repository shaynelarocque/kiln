import { SYMBOLS } from "./catalog"
import type { Arg, Op } from "./ops"

const SYMBOL_BY_CHAR = new Map(SYMBOLS.map(s => [String.fromCodePoint(s.cp), s.name]))

/**
 * A C string literal for UTF-8 text. LVGL symbols become their LV_SYMBOL_* macros, other
 * non-ASCII bytes become \x escapes (split so a following hex digit isn't swallowed).
 */
export function cString(text: string): string {
  const parts: string[] = []
  let lit = ""
  let lastHex = false
  const flush = () => {
    if (lit) parts.push(`"${lit}"`)
    lit = ""
    lastHex = false
  }
  for (const ch of text) {
    const symbol = SYMBOL_BY_CHAR.get(ch)
    if (symbol) {
      flush()
      parts.push(symbol)
      continue
    }
    const code = ch.codePointAt(0)!
    if (code < 0x80) {
      if (lastHex && /[0-9a-fA-F]/.test(ch)) flush()
      lastHex = false
      if (ch === '"' || ch === "\\") lit += "\\" + ch
      else if (ch === "\n") lit += "\\n"
      else if (ch === "\t") lit += "\\t"
      else if (code < 0x20 || code === 0x7f) {
        lit += `\\x${code.toString(16).padStart(2, "0")}`
        lastHex = true
      } else lit += ch
      continue
    }
    for (const b of new TextEncoder().encode(ch)) lit += `\\x${b.toString(16).toUpperCase()}`
    lastHex = true
  }
  flush()
  return parts.length ? parts.join(" ") : '""'
}

export const cColor = (color: string) => `lv_color_hex(0x${color.slice(1).toUpperCase()})`

/** User text made safe inside a C block comment: no way to close it early, no control characters. */
export const cComment = (text: string) =>
  text.replace(/\*\//g, "* /").replace(/[\x00-\x1f\x7f]/g, " ")

const name = (names: Record<string, string>, id: string) => {
  const n = names[id]
  if (!n) throw new Error(`No C name for "${id}"`)
  return n
}

export function argToC(a: Arg, names: Record<string, string>): string {
  switch (a.k) {
    case "obj":
    case "timeline":
    case "series":
    case "subject":
      return name(names, a.id)
    case "style":
    case "transition":
    case "image":
      return `&${name(names, a.id)}`
    case "int":
      return String(a.v)
    case "bool":
      return a.v ? "true" : "false"
    case "const":
      return a.names.length ? a.names.join(" | ") : "0"
    case "coord":
      if (typeof a.v === "number") return String(Math.round(a.v))
      return a.v === "content" ? "LV_SIZE_CONTENT" : `lv_pct(${Math.round(parseFloat(a.v))})`
    case "str":
      return cString(a.v)
    case "color":
      return a.token ? `lv_color_hex(${a.token})` : cColor(a.v)
    case "hex":
      return `0x${a.v.toString(16).toUpperCase().padStart(6, "0")}`
    case "font":
      return `&${a.name}`
    case "tiny_ttf":
    case "frames":
      return name(names, a.id)
    case "anim":
      return "&a"
    case "fn":
      return a.cast ? `(${a.cast})${a.name}` : a.name
    case "null":
      return "NULL"
  }
}

/** One op as C statements. Declarations are the caller's job (see declarations()). */
export function opToC(op: Op, names: Record<string, string>): string[] {
  switch (op.op) {
    case "create":
      return [`${name(names, op.id)} = ${op.fn}(${op.parent ? name(names, op.parent) : "NULL"});`]
    case "call": {
      const target = op.ret ? `${name(names, op.ret.id)} = ` : ""
      return [`${target}${op.fn}(${op.args.map(a => argToC(a, names)).join(", ")});`]
    }
    case "subject": {
      const n = name(names, op.id)
      if (op.type === "string")
        return [
          `${n} = lv_subject_create(LV_SUBJECT_TYPE_STRING);`,
          `lv_subject_set_string_buffer_static(${n}, ${n}_buf, ${n}_prev, sizeof(${n}_buf));`,
          `lv_subject_set_string(${n}, ${cString(String(op.init))});`,
        ]
      if (op.type === "color")
        return [
          `${n} = lv_subject_create(LV_SUBJECT_TYPE_COLOR);`,
          `lv_subject_set_color(${n}, ${cColor(String(op.init))});`,
        ]
      return [
        `${n} = lv_subject_create(LV_SUBJECT_TYPE_INT);`,
        ...(op.min !== undefined ? [`lv_subject_set_min_value_int(${n}, ${op.min});`] : []),
        ...(op.max !== undefined ? [`lv_subject_set_max_value_int(${n}, ${op.max});`] : []),
        `lv_subject_set_int(${n}, ${op.init});`,
      ]
    }
    case "style":
      return [`lv_style_init(&${name(names, op.id)});`]
    case "transition": {
      const n = name(names, op.id)
      return [
        `lv_style_transition_dsc_init(&${n}, ${n}_props, ${op.path}, ${op.time}, ${op.delay}, NULL);`,
      ]
    }
    case "image":
    case "ttf":
    case "frames":
      return []
    case "tiny_ttf": {
      const ttf = name(names, op.ttf)
      return [
        `${name(names, op.id)} = kiln_tiny_ttf(${ttf}, sizeof(${ttf}), ${op.size}, ${op.cache}, ${op.fallback ? `&${op.fallback}` : "NULL"});`,
      ]
    }
  }
}

export type Declaration = {
  kind:
    | "obj"
    | "subject"
    | "style"
    | "transition"
    | "timeline"
    | "series"
    | "image"
    | "ttf"
    | "font"
    | "frames"
  c: string
  name: string
}

/** Globals the ops need, in the order they appear. Images get their pixel data inline. */
export function declarations(ops: Op[], names: Record<string, string>): Declaration[] {
  const out: Declaration[] = []
  for (const op of ops) {
    if (op.op === "create") {
      const n = name(names, op.id)
      out.push({ kind: "obj", name: n, c: `lv_obj_t * ${n};` })
    } else if (op.op === "subject") {
      const n = name(names, op.id)
      const bufs = op.type === "string" ? `\nstatic char ${n}_buf[64], ${n}_prev[64];` : ""
      out.push({ kind: "subject", name: n, c: `lv_subject_t * ${n};${bufs}` })
    } else if (op.op === "style") {
      const n = name(names, op.id)
      out.push({ kind: "style", name: n, c: `lv_style_t ${n};` })
    } else if (op.op === "transition") {
      const n = name(names, op.id)
      out.push({
        kind: "transition",
        name: n,
        c: `static const lv_style_prop_t ${n}_props[] = { ${[...op.props, "0"].join(", ")} };\nlv_style_transition_dsc_t ${n};`,
      })
    } else if (op.op === "call" && op.ret) {
      const n = name(names, op.ret.id)
      const type = op.ret.kind === "timeline" ? "lv_anim_timeline_t" : "lv_chart_series_t"
      out.push({ kind: op.ret.kind, name: n, c: `${type} * ${n};` })
    } else if (op.op === "image") {
      const n = name(names, op.id)
      out.push({ kind: "image", name: n, c: imageToC(op, n) })
    } else if (op.op === "ttf") {
      const n = name(names, op.id)
      out.push({
        kind: "ttf",
        name: n,
        c: [
          `LV_ATTRIBUTE_LARGE_CONST const uint8_t ${n}[${op.data.length}] = {`,
          ...hexRows(op.data),
          "};",
        ].join("\n"),
      })
    } else if (op.op === "frames") {
      const n = name(names, op.id)
      const frames = op.images.map(id => `&${name(names, id)}`).join(", ")
      out.push({ kind: "frames", name: n, c: `const void * ${n}[] = { ${frames} };` })
    } else if (op.op === "tiny_ttf") {
      const n = name(names, op.id)
      out.push({ kind: "font", name: n, c: `const lv_font_t * ${n};` })
    }
  }
  return out
}

function hexRows(data: Uint8Array) {
  const rows: string[] = []
  for (let i = 0; i < data.length; i += 24)
    rows.push(
      "    " +
        Array.from(data.subarray(i, i + 24), b => `0x${b.toString(16).padStart(2, "0")}`).join(
          ", ",
        ) +
        ",",
    )
  return rows
}

function imageToC(op: Extract<Op, { op: "image" }>, n: string) {
  return [
    `static const LV_ATTRIBUTE_MEM_ALIGN uint8_t ${n}_map[] = {`,
    ...hexRows(op.data),
    "};",
    "",
    `const lv_image_dsc_t ${n} = {`,
    "    .header = {",
    "        .magic = LV_IMAGE_HEADER_MAGIC,",
    `        .cf = ${op.cf},`,
    `        .w = ${op.w},`,
    `        .h = ${op.h},`,
    `        .stride = ${op.stride},`,
    "    },",
    `    .data_size = sizeof(${n}_map),`,
    `    .data = ${n}_map,`,
    "};",
  ].join("\n")
}

/** Whether a block of ops configures the scratch lv_anim_t (so the C function needs `lv_anim_t a;`). */
export const usesAnim = (ops: Op[]) =>
  ops.some(op => op.op === "call" && op.args.some(a => a.k === "anim"))
