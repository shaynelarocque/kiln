/**
 * What Kiln knows about LVGL 9.6: widgets, style props, enums. Constant names are written out
 * in full on purpose: runtime/gen-consts.mjs scans for "LV_..." literals to build the wasm lookup table.
 */
import type { Arg, Coord } from "./ops"

export type Option = { value: string; label: string }

export const LVGL_VERSION = "9.6.0"

/*---------- selectors: parts and states, written "part:state" or "part:state+state" ----------*/

export const PARTS = [
  { value: "main", label: "Main", c: "LV_PART_MAIN" },
  { value: "indicator", label: "Indicator", c: "LV_PART_INDICATOR" },
  { value: "knob", label: "Knob", c: "LV_PART_KNOB" },
  { value: "items", label: "Items", c: "LV_PART_ITEMS" },
  { value: "selected", label: "Selected", c: "LV_PART_SELECTED" },
  { value: "scrollbar", label: "Scrollbar", c: "LV_PART_SCROLLBAR" },
] as const
export type Part = (typeof PARTS)[number]["value"]

export const STATES = [
  { value: "default", label: "Default", c: "LV_STATE_DEFAULT" },
  { value: "pressed", label: "Pressed", c: "LV_STATE_PRESSED" },
  { value: "checked", label: "Checked", c: "LV_STATE_CHECKED" },
  { value: "focused", label: "Focused", c: "LV_STATE_FOCUSED" },
  { value: "disabled", label: "Disabled", c: "LV_STATE_DISABLED" },
  { value: "user_1", label: "User 1", c: "LV_STATE_USER_1" },
  { value: "user_2", label: "User 2", c: "LV_STATE_USER_2" },
] as const
export type State = (typeof STATES)[number]["value"]

export const MAIN_DEFAULT = "main:default"

/** "indicator:checked+pressed" → ["LV_PART_INDICATOR", "LV_STATE_CHECKED", "LV_STATE_PRESSED"] */
export function selectorConsts(key: string): string[] {
  const [part, states = "default"] = key.split(":")
  const p = PARTS.find(x => x.value === part)?.c ?? "LV_PART_MAIN"
  const s = states.split("+").map(st => STATES.find(x => x.value === st)?.c ?? "LV_STATE_DEFAULT")
  return [p, ...s]
}

/*---------- enums ----------*/

export const ALIGN: Option[] = [
  { value: "LV_ALIGN_TOP_LEFT", label: "Top left" },
  { value: "LV_ALIGN_TOP_MID", label: "Top" },
  { value: "LV_ALIGN_TOP_RIGHT", label: "Top right" },
  { value: "LV_ALIGN_LEFT_MID", label: "Left" },
  { value: "LV_ALIGN_CENTER", label: "Center" },
  { value: "LV_ALIGN_RIGHT_MID", label: "Right" },
  { value: "LV_ALIGN_BOTTOM_LEFT", label: "Bottom left" },
  { value: "LV_ALIGN_BOTTOM_MID", label: "Bottom" },
  { value: "LV_ALIGN_BOTTOM_RIGHT", label: "Bottom right" },
]

/** How an LVGL align anchors a box: 0 left/top, 0.5 middle, 1 right/bottom. */
export function alignFactors(align: string): [number, number] {
  const ax = /RIGHT/.test(align) ? 1 : /MID|CENTER/.test(align) && !/LEFT_MID|RIGHT_MID/.test(align) ? 0.5 : 0
  const ay = /BOTTOM/.test(align) ? 1 : /LEFT_MID|RIGHT_MID|CENTER/.test(align) ? 0.5 : 0
  return [ax, ay]
}

/** The in-parent LV_ALIGN_* for anchor factors (alignFactors' inverse). */
export function alignName(ax: number, ay: number) {
  const index = [0, 0.5, 1].indexOf(ay) * 3 + [0, 0.5, 1].indexOf(ax)
  return ["LV_ALIGN_TOP_LEFT", "LV_ALIGN_TOP_MID", "LV_ALIGN_TOP_RIGHT", "LV_ALIGN_LEFT_MID", "LV_ALIGN_CENTER", "LV_ALIGN_RIGHT_MID", "LV_ALIGN_BOTTOM_LEFT", "LV_ALIGN_BOTTOM_MID", "LV_ALIGN_BOTTOM_RIGHT"][index]
}

export const FLEX_FLOW: Option[] = [
  { value: "LV_FLEX_FLOW_ROW", label: "Row" },
  { value: "LV_FLEX_FLOW_COLUMN", label: "Column" },
  { value: "LV_FLEX_FLOW_ROW_WRAP", label: "Row, wrap" },
  { value: "LV_FLEX_FLOW_COLUMN_WRAP", label: "Column, wrap" },
  { value: "LV_FLEX_FLOW_ROW_REVERSE", label: "Row, reversed" },
  { value: "LV_FLEX_FLOW_COLUMN_REVERSE", label: "Column, reversed" },
]

export const FLEX_ALIGN: Option[] = [
  { value: "LV_FLEX_ALIGN_START", label: "Start" },
  { value: "LV_FLEX_ALIGN_CENTER", label: "Center" },
  { value: "LV_FLEX_ALIGN_END", label: "End" },
  { value: "LV_FLEX_ALIGN_SPACE_BETWEEN", label: "Space between" },
  { value: "LV_FLEX_ALIGN_SPACE_AROUND", label: "Space around" },
  { value: "LV_FLEX_ALIGN_SPACE_EVENLY", label: "Space evenly" },
]

const TEXT_ALIGN: Option[] = [
  { value: "LV_TEXT_ALIGN_AUTO", label: "Auto" },
  { value: "LV_TEXT_ALIGN_LEFT", label: "Left" },
  { value: "LV_TEXT_ALIGN_CENTER", label: "Center" },
  { value: "LV_TEXT_ALIGN_RIGHT", label: "Right" },
]

const TEXT_DECOR: Option[] = [
  { value: "LV_TEXT_DECOR_NONE", label: "None" },
  { value: "LV_TEXT_DECOR_UNDERLINE", label: "Underline" },
  { value: "LV_TEXT_DECOR_STRIKETHROUGH", label: "Strikethrough" },
]

/** Linear/radial/conical need LV_USE_DRAW_SW_COMPLEX_GRADIENTS, too heavy for a C3. */
const GRAD_DIR: Option[] = [
  { value: "LV_GRAD_DIR_NONE", label: "None" },
  { value: "LV_GRAD_DIR_VER", label: "Vertical" },
  { value: "LV_GRAD_DIR_HOR", label: "Horizontal" },
]

const BORDER_SIDE: Option[] = [
  { value: "LV_BORDER_SIDE_FULL", label: "All" },
  { value: "LV_BORDER_SIDE_TOP", label: "Top" },
  { value: "LV_BORDER_SIDE_BOTTOM", label: "Bottom" },
  { value: "LV_BORDER_SIDE_LEFT", label: "Left" },
  { value: "LV_BORDER_SIDE_RIGHT", label: "Right" },
  { value: "LV_BORDER_SIDE_NONE", label: "None" },
]

export const SCREEN_LOAD_ANIM: Option[] = [
  { value: "LV_SCREEN_LOAD_ANIM_NONE", label: "Instant" },
  { value: "LV_SCREEN_LOAD_ANIM_FADE_IN", label: "Fade" },
  { value: "LV_SCREEN_LOAD_ANIM_MOVE_LEFT", label: "Push left" },
  { value: "LV_SCREEN_LOAD_ANIM_MOVE_RIGHT", label: "Push right" },
  { value: "LV_SCREEN_LOAD_ANIM_MOVE_TOP", label: "Push up" },
  { value: "LV_SCREEN_LOAD_ANIM_MOVE_BOTTOM", label: "Push down" },
  { value: "LV_SCREEN_LOAD_ANIM_OVER_LEFT", label: "Slide over left" },
  { value: "LV_SCREEN_LOAD_ANIM_OVER_RIGHT", label: "Slide over right" },
  { value: "LV_SCREEN_LOAD_ANIM_OVER_TOP", label: "Slide over up" },
  { value: "LV_SCREEN_LOAD_ANIM_OVER_BOTTOM", label: "Slide over down" },
]

export const EVENTS: Option[] = [
  { value: "LV_EVENT_CLICKED", label: "Click" },
  { value: "LV_EVENT_PRESSED", label: "Press" },
  { value: "LV_EVENT_RELEASED", label: "Release" },
  { value: "LV_EVENT_LONG_PRESSED", label: "Long press" },
  { value: "LV_EVENT_VALUE_CHANGED", label: "Value change" },
  { value: "LV_EVENT_SCREEN_LOADED", label: "Screen loaded" },
]

export const BIND_FLAGS: Option[] = [
  { value: "LV_OBJ_FLAG_HIDDEN", label: "Hidden" },
  { value: "LV_OBJ_FLAG_CLICKABLE", label: "Clickable" },
]

export const BIND_STATES: Option[] = [
  { value: "LV_STATE_CHECKED", label: "Checked" },
  { value: "LV_STATE_DISABLED", label: "Disabled" },
  { value: "LV_STATE_USER_1", label: "User 1" },
  { value: "LV_STATE_USER_2", label: "User 2" },
]

export const COMPARE: Option[] = [
  { value: "eq", label: "=" },
  { value: "not_eq", label: "≠" },
  { value: "gt", label: ">" },
  { value: "ge", label: "≥" },
  { value: "lt", label: "<" },
  { value: "le", label: "≤" },
]

/*---------- fonts ----------*/

export const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48]
export const FONTS: Option[] = [
  ...FONT_SIZES.map(s => ({ value: `lv_font_montserrat_${s}`, label: `Montserrat ${s}` })),
  { value: "lv_font_unscii_8", label: "Unscii 8 (pixel)" },
  { value: "lv_font_unscii_16", label: "Unscii 16 (pixel)" },
]
export const DEFAULT_FONT = "lv_font_montserrat_14"

/** lv_font_montserrat_20 → LV_FONT_MONTSERRAT_20, the lv_conf.h switch that compiles it in. */
export const fontConfName = (font: string) => font.replace(/^lv_font_/, "LV_FONT_").toUpperCase()

/** The built-in Montserrat size nearest to `px`. */
export const nearestFontSize = (px: number) => FONT_SIZES.reduce((a, b) => (Math.abs(b - px) < Math.abs(a - px) ? b : a))

/** Pixel sizes an imported font can be used at (TinyTTF draws any size; LVGL asserts on 0). */
export const TTF_SIZES = { min: 6, max: 160 }
/** Glyphs TinyTTF keeps drawn per font size: a UI's digits and labels, without filling a C3's heap. */
export const TTF_GLYPH_CACHE = 48

/** How a style names an imported font at one size; built-in fonts go by their C names. */
export const ttfFont = (id: string, size: number) => `ttf:${id}:${size}`

/** The font id and pixel size in a `ttf:` style value, or null for anything else. */
export function parseTtfFont(value: unknown) {
  const m = typeof value === "string" ? /^ttf:(\w+):(\d+)$/.exec(value) : null
  return m ? { id: m[1], size: Number(m[2]) } : null
}

/*---------- style props ----------*/

export type StyleType =
  | "color"
  | "opa"
  | "px"
  | "int"
  | "angle"
  | "scale"
  | "enum"
  | "font"
  | "bool"
  | "image"

export const STYLE_GROUPS = [
  { value: "fill", label: "Fill" },
  { value: "border", label: "Border" },
  { value: "shadow", label: "Shadow" },
  { value: "outline", label: "Outline" },
  { value: "text", label: "Text" },
  { value: "spacing", label: "Padding" },
  { value: "transform", label: "Transform" },
  { value: "arc", label: "Arc" },
  { value: "line", label: "Line" },
  { value: "image", label: "Image" },
] as const
export type StyleGroup = (typeof STYLE_GROUPS)[number]["value"]

export type StyleProp = {
  name: string
  label: string
  type: StyleType
  group: StyleGroup
  options?: Option[]
  min?: number
  max?: number
}

const p = (
  group: StyleGroup,
  name: string,
  label: string,
  type: StyleType,
  extra: Partial<StyleProp> = {},
): StyleProp => ({ group, name, label, type, ...extra })

export const STYLE_PROPS: StyleProp[] = [
  p("fill", "bg_color", "Color", "color"),
  p("fill", "bg_opa", "Opacity", "opa"),
  p("fill", "bg_grad_dir", "Gradient", "enum", { options: GRAD_DIR }),
  p("fill", "bg_grad_color", "Gradient to", "color"),
  p("fill", "bg_main_stop", "Gradient start", "int", { min: 0, max: 255 }),
  p("fill", "bg_grad_stop", "Gradient end", "int", { min: 0, max: 255 }),
  p("border", "radius", "Radius", "px", { min: 0 }),
  p("border", "border_width", "Width", "px", { min: 0 }),
  p("border", "border_color", "Color", "color"),
  p("border", "border_opa", "Opacity", "opa"),
  p("border", "border_side", "Sides", "enum", { options: BORDER_SIDE }),
  p("shadow", "shadow_width", "Blur", "px", { min: 0 }),
  p("shadow", "shadow_spread", "Spread", "px"),
  p("shadow", "shadow_offset_x", "Offset X", "px"),
  p("shadow", "shadow_offset_y", "Offset Y", "px"),
  p("shadow", "shadow_color", "Color", "color"),
  p("shadow", "shadow_opa", "Opacity", "opa"),
  p("outline", "outline_width", "Width", "px", { min: 0 }),
  p("outline", "outline_pad", "Gap", "px"),
  p("outline", "outline_color", "Color", "color"),
  p("outline", "outline_opa", "Opacity", "opa"),
  p("text", "text_font", "Font", "font"),
  p("text", "text_color", "Color", "color"),
  p("text", "text_opa", "Opacity", "opa"),
  p("text", "text_align", "Align", "enum", { options: TEXT_ALIGN }),
  p("text", "text_letter_space", "Letter spacing", "px"),
  p("text", "text_line_space", "Line spacing", "px"),
  p("text", "text_decor", "Decoration", "enum", { options: TEXT_DECOR }),
  p("spacing", "pad_top", "Top", "px"),
  p("spacing", "pad_right", "Right", "px"),
  p("spacing", "pad_bottom", "Bottom", "px"),
  p("spacing", "pad_left", "Left", "px"),
  p("spacing", "pad_row", "Row gap", "px"),
  p("spacing", "pad_column", "Column gap", "px"),
  p("transform", "opa", "Opacity", "opa"),
  p("transform", "translate_x", "Translate X", "px"),
  p("transform", "translate_y", "Translate Y", "px"),
  p("transform", "transform_rotation", "Rotation", "angle"),
  p("transform", "transform_scale_x", "Scale X", "scale"),
  p("transform", "transform_scale_y", "Scale Y", "scale"),
  p("transform", "transform_pivot_x", "Pivot X", "px"),
  p("transform", "transform_pivot_y", "Pivot Y", "px"),
  p("arc", "arc_width", "Width", "px", { min: 0 }),
  p("arc", "arc_color", "Color", "color"),
  p("arc", "arc_opa", "Opacity", "opa"),
  p("arc", "arc_rounded", "Rounded ends", "bool"),
  p("line", "line_width", "Width", "px", { min: 0 }),
  p("line", "line_color", "Color", "color"),
  p("line", "line_opa", "Opacity", "opa"),
  p("line", "line_rounded", "Rounded ends", "bool"),
  p("image", "image_recolor", "Recolor", "color"),
  p("image", "image_recolor_opa", "Recolor amount", "opa"),
  p("image", "image_opa", "Opacity", "opa"),
]

export const styleProp = (name: string) => STYLE_PROPS.find(s => s.name === name)

/** lv_obj_set_style_<name> / lv_style_set_<name> → LV_STYLE_<NAME> */
export const stylePropConst = (name: string) => `LV_STYLE_${name.toUpperCase()}`

/** Props that change how the box renders (and so what a transition can animate). */
export const TRANSITION_PROPS = STYLE_PROPS.filter(s =>
  ["color", "opa", "px", "angle", "scale"].includes(s.type),
).map(s => s.name)

/*---------- easing ----------*/

export type Easing =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "overshoot"
  | "bounce"
  | "step"
  | `cubic-bezier(${string})`

export const EASINGS: Option[] = [
  { value: "linear", label: "Linear" },
  { value: "ease", label: "Ease" },
  { value: "ease-in", label: "Ease in" },
  { value: "ease-out", label: "Ease out" },
  { value: "ease-in-out", label: "Ease in-out" },
  { value: "overshoot", label: "Overshoot" },
  { value: "bounce", label: "Bounce" },
  { value: "step", label: "Step" },
]

const BEZIER: Record<string, [number, number, number, number]> = {
  "ease": [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
}

/** CSS easing → an LVGL path, plus bezier control points (in 1/1024ths) when it's a curve. */
export function easingPath(easing: Easing): { path: string; bezier?: number[] } {
  const custom = /^cubic-bezier\((.+)\)$/.exec(easing)?.[1].split(",").map(Number)
  const curve = custom?.length === 4 && custom.every(Number.isFinite) ? custom : BEZIER[easing]
  if (curve) return { path: "lv_anim_path_custom_bezier3", bezier: curve.map(v => Math.round(v * 1024)) }
  if (easing === "overshoot" || easing === "bounce" || easing === "step" || easing === "linear")
    return { path: `lv_anim_path_${easing}` }
  return { path: "lv_anim_path_linear" }
}

/** Style transitions can't carry bezier params, so curves fall back to LVGL's named easings. */
export function transitionPath(easing: Easing): string {
  if (easing === "ease-in") return "lv_anim_path_ease_in"
  if (easing === "ease-in-out") return "lv_anim_path_ease_in_out"
  if (easing === "linear" || easing === "overshoot" || easing === "bounce" || easing === "step")
    return `lv_anim_path_${easing}`
  return "lv_anim_path_ease_out"
}

/*---------- animatable properties ----------*/

export type AnimUnit = "px" | "opa" | "angle" | "scale" | "color" | "int"
export type AnimProp = {
  value: string
  label: string
  unit: AnimUnit
  /** how the lv_anim_t drives it: an int setter, a numeric style prop, scale, or a colour prop */
  drive: { exec: string } | { style: string } | { scale: true } | { color: string }
  widgets?: WidgetType[]
}

export const ANIM_PROPS: AnimProp[] = [
  { value: "translate_x", label: "Move X", unit: "px", drive: { style: "LV_STYLE_TRANSLATE_X" } },
  { value: "translate_y", label: "Move Y", unit: "px", drive: { style: "LV_STYLE_TRANSLATE_Y" } },
  { value: "opa", label: "Opacity", unit: "opa", drive: { style: "LV_STYLE_OPA" } },
  { value: "scale", label: "Scale", unit: "scale", drive: { scale: true } },
  {
    value: "rotation",
    label: "Rotation",
    unit: "angle",
    drive: { style: "LV_STYLE_TRANSFORM_ROTATION" },
  },
  { value: "x", label: "X", unit: "px", drive: { exec: "lv_obj_set_x" } },
  { value: "y", label: "Y", unit: "px", drive: { exec: "lv_obj_set_y" } },
  { value: "width", label: "Width", unit: "px", drive: { exec: "lv_obj_set_width" } },
  { value: "height", label: "Height", unit: "px", drive: { exec: "lv_obj_set_height" } },
  { value: "radius", label: "Radius", unit: "px", drive: { style: "LV_STYLE_RADIUS" } },
  { value: "bg_color", label: "Fill color", unit: "color", drive: { color: "LV_STYLE_BG_COLOR" } },
  {
    value: "text_color",
    label: "Text color",
    unit: "color",
    drive: { color: "LV_STYLE_TEXT_COLOR" },
  },
  {
    value: "border_color",
    label: "Border color",
    unit: "color",
    drive: { color: "LV_STYLE_BORDER_COLOR" },
  },
  {
    value: "arc_value",
    label: "Arc value",
    unit: "int",
    drive: { exec: "lv_arc_set_value" },
    widgets: ["arc"],
  },
]

/*---------- widgets ----------*/

export type WidgetType =
  | "screen"
  | "container"
  | "label"
  | "button"
  | "image"
  | "arc"
  | "bar"
  | "slider"
  | "switch"
  | "checkbox"
  | "spinner"
  | "led"
  | "dropdown"
  | "roller"
  | "scale"
  | "chart"

export type WidgetPropType = "text" | "lines" | "int" | "bool" | "enum" | "color" | "image"
export type WidgetProp = {
  key: string
  label: string
  type: WidgetPropType
  default: string | number | boolean | null
  options?: Option[]
  min?: number
  max?: number
}

/** A setter call; strings name props, anything else is passed as is. Skipped if a named prop is null. */
export type WidgetCall = { fn: string; args: (string | Arg)[] }

/** Value bindings a widget supports beyond the universal ones (visibility, state, style). */
export type ValueBinding = "text" | "value" | "checked" | "series"

export type WidgetDef = {
  type: WidgetType
  label: string
  create: string
  parts: Part[]
  container?: boolean
  size: [Coord, Coord]
  props: WidgetProp[]
  calls: WidgetCall[]
  bind: ValueBinding[]
}

const ANIM_OFF: Arg = { k: "const", names: ["LV_ANIM_OFF"] }
const range = (min: number, max: number, value: number): WidgetProp[] => [
  { key: "min", label: "Min", type: "int", default: min },
  { key: "max", label: "Max", type: "int", default: max },
  { key: "value", label: "Value", type: "int", default: value },
]

export const WIDGETS: Record<WidgetType, WidgetDef> = {
  screen: {
    type: "screen",
    label: "Screen",
    create: "lv_obj_create",
    parts: ["main", "scrollbar"],
    container: true,
    size: [240, 240],
    props: [],
    calls: [],
    bind: [],
  },
  container: {
    type: "container",
    label: "Container",
    create: "lv_obj_create",
    parts: ["main", "scrollbar"],
    container: true,
    size: [120, 80],
    props: [],
    calls: [],
    bind: [],
  },
  label: {
    type: "label",
    label: "Text",
    create: "lv_label_create",
    parts: ["main"],
    size: ["content", "content"],
    props: [
      { key: "text", label: "Text", type: "text", default: "Text" },
      {
        key: "longMode",
        label: "Overflow",
        type: "enum",
        default: "LV_LABEL_LONG_MODE_WRAP",
        options: [
          { value: "LV_LABEL_LONG_MODE_WRAP", label: "Wrap" },
          { value: "LV_LABEL_LONG_MODE_DOTS", label: "Ellipsis" },
          { value: "LV_LABEL_LONG_MODE_SCROLL", label: "Scroll" },
          { value: "LV_LABEL_LONG_MODE_SCROLL_CIRCULAR", label: "Marquee" },
          { value: "LV_LABEL_LONG_MODE_CLIP", label: "Clip" },
        ],
      },
    ],
    calls: [
      { fn: "lv_label_set_long_mode", args: ["longMode"] },
      { fn: "lv_label_set_text", args: ["text"] },
    ],
    bind: ["text"],
  },
  button: {
    type: "button",
    label: "Button",
    create: "lv_button_create",
    parts: ["main"],
    container: true,
    size: [120, 44],
    props: [],
    calls: [],
    bind: ["checked"],
  },
  image: {
    type: "image",
    label: "Image",
    create: "lv_image_create",
    parts: ["main"],
    size: ["content", "content"],
    props: [{ key: "src", label: "Image", type: "image", default: null }],
    calls: [{ fn: "lv_image_set_src", args: ["src"] }],
    bind: [],
  },
  arc: {
    type: "arc",
    label: "Arc",
    create: "lv_arc_create",
    parts: ["main", "indicator", "knob"],
    size: [150, 150],
    props: [
      ...range(0, 100, 40),
      { key: "bgStart", label: "Start angle", type: "int", default: 135, min: 0, max: 360 },
      { key: "bgEnd", label: "End angle", type: "int", default: 45, min: 0, max: 360 },
      { key: "rotation", label: "Rotation", type: "int", default: 0, min: 0, max: 360 },
      {
        key: "mode",
        label: "Mode",
        type: "enum",
        default: "LV_ARC_MODE_NORMAL",
        options: [
          { value: "LV_ARC_MODE_NORMAL", label: "Normal" },
          { value: "LV_ARC_MODE_SYMMETRICAL", label: "Symmetrical" },
          { value: "LV_ARC_MODE_REVERSE", label: "Reverse" },
        ],
      },
    ],
    calls: [
      { fn: "lv_arc_set_range", args: ["min", "max"] },
      { fn: "lv_arc_set_bg_angles", args: ["bgStart", "bgEnd"] },
      { fn: "lv_arc_set_rotation", args: ["rotation"] },
      { fn: "lv_arc_set_mode", args: ["mode"] },
      { fn: "lv_arc_set_value", args: ["value"] },
    ],
    bind: ["value"],
  },
  bar: {
    type: "bar",
    label: "Bar",
    create: "lv_bar_create",
    parts: ["main", "indicator"],
    size: [160, 16],
    props: [
      ...range(0, 100, 60),
      {
        key: "mode",
        label: "Mode",
        type: "enum",
        default: "LV_BAR_MODE_NORMAL",
        options: [
          { value: "LV_BAR_MODE_NORMAL", label: "Normal" },
          { value: "LV_BAR_MODE_SYMMETRICAL", label: "Symmetrical" },
        ],
      },
    ],
    calls: [
      { fn: "lv_bar_set_range", args: ["min", "max"] },
      { fn: "lv_bar_set_mode", args: ["mode"] },
      { fn: "lv_bar_set_value", args: ["value", ANIM_OFF] },
    ],
    bind: ["value"],
  },
  slider: {
    type: "slider",
    label: "Slider",
    create: "lv_slider_create",
    parts: ["main", "indicator", "knob"],
    size: [160, 10],
    props: range(0, 100, 50),
    calls: [
      { fn: "lv_slider_set_range", args: ["min", "max"] },
      { fn: "lv_slider_set_value", args: ["value", ANIM_OFF] },
    ],
    bind: ["value"],
  },
  switch: {
    type: "switch",
    label: "Switch",
    create: "lv_switch_create",
    parts: ["main", "indicator", "knob"],
    size: [50, 26],
    props: [],
    calls: [],
    bind: ["checked"],
  },
  checkbox: {
    type: "checkbox",
    label: "Checkbox",
    create: "lv_checkbox_create",
    parts: ["main", "indicator"],
    size: ["content", "content"],
    props: [{ key: "text", label: "Text", type: "text", default: "Checkbox" }],
    calls: [{ fn: "lv_checkbox_set_text", args: ["text"] }],
    bind: ["checked"],
  },
  spinner: {
    type: "spinner",
    label: "Spinner",
    create: "lv_spinner_create",
    parts: ["main", "indicator"],
    size: [48, 48],
    props: [
      { key: "duration", label: "Lap (ms)", type: "int", default: 1000, min: 100 },
      { key: "sweep", label: "Arc length", type: "int", default: 200, min: 10, max: 360 },
    ],
    calls: [{ fn: "lv_spinner_set_anim_params", args: ["duration", "sweep"] }],
    bind: [],
  },
  led: {
    type: "led",
    label: "LED",
    create: "lv_led_create",
    parts: ["main"],
    size: [20, 20],
    props: [
      { key: "color", label: "Color", type: "color", default: "#ff3b30" },
      { key: "brightness", label: "Brightness", type: "int", default: 255, min: 0, max: 255 },
    ],
    calls: [
      { fn: "lv_led_set_color", args: ["color"] },
      { fn: "lv_led_set_brightness", args: ["brightness"] },
    ],
    bind: [],
  },
  dropdown: {
    type: "dropdown",
    label: "Dropdown",
    create: "lv_dropdown_create",
    parts: ["main", "indicator"],
    size: [150, "content"],
    props: [
      { key: "options", label: "Options", type: "lines", default: "Option 1\nOption 2\nOption 3" },
      { key: "selected", label: "Selected", type: "int", default: 0, min: 0 },
    ],
    calls: [
      { fn: "lv_dropdown_set_options", args: ["options"] },
      { fn: "lv_dropdown_set_selected", args: ["selected"] },
    ],
    bind: ["value"],
  },
  roller: {
    type: "roller",
    label: "Roller",
    create: "lv_roller_create",
    parts: ["main", "selected"],
    size: [120, "content"],
    props: [
      { key: "options", label: "Options", type: "lines", default: "Mon\nTue\nWed\nThu\nFri" },
      {
        key: "mode",
        label: "Loop",
        type: "enum",
        default: "LV_ROLLER_MODE_NORMAL",
        options: [
          { value: "LV_ROLLER_MODE_NORMAL", label: "No" },
          { value: "LV_ROLLER_MODE_INFINITE", label: "Yes" },
        ],
      },
      { key: "rows", label: "Visible rows", type: "int", default: 3, min: 1 },
      { key: "selected", label: "Selected", type: "int", default: 0, min: 0 },
    ],
    calls: [
      { fn: "lv_roller_set_options", args: ["options", "mode"] },
      { fn: "lv_roller_set_visible_row_count", args: ["rows"] },
      { fn: "lv_roller_set_selected", args: ["selected", ANIM_OFF] },
    ],
    bind: ["value"],
  },
  scale: {
    type: "scale",
    label: "Scale",
    create: "lv_scale_create",
    parts: ["main", "items", "indicator"],
    size: [150, 150],
    props: [
      {
        key: "mode",
        label: "Mode",
        type: "enum",
        default: "LV_SCALE_MODE_ROUND_INNER",
        options: [
          { value: "LV_SCALE_MODE_ROUND_INNER", label: "Round, inside" },
          { value: "LV_SCALE_MODE_ROUND_OUTER", label: "Round, outside" },
          { value: "LV_SCALE_MODE_HORIZONTAL_BOTTOM", label: "Horizontal" },
          { value: "LV_SCALE_MODE_VERTICAL_LEFT", label: "Vertical" },
        ],
      },
      { key: "min", label: "Min", type: "int", default: 0 },
      { key: "max", label: "Max", type: "int", default: 100 },
      { key: "ticks", label: "Ticks", type: "int", default: 21, min: 2 },
      { key: "majorEvery", label: "Major every", type: "int", default: 5, min: 1 },
      { key: "labels", label: "Labels", type: "bool", default: true },
      { key: "angleRange", label: "Sweep", type: "int", default: 270, min: 0, max: 360 },
      { key: "rotation", label: "Rotation", type: "int", default: 135, min: 0, max: 360 },
    ],
    calls: [
      { fn: "lv_scale_set_mode", args: ["mode"] },
      { fn: "lv_scale_set_range", args: ["min", "max"] },
      { fn: "lv_scale_set_total_tick_count", args: ["ticks"] },
      { fn: "lv_scale_set_major_tick_every", args: ["majorEvery"] },
      { fn: "lv_scale_set_label_show", args: ["labels"] },
      { fn: "lv_scale_set_angle_range", args: ["angleRange"] },
      { fn: "lv_scale_set_rotation", args: ["rotation"] },
    ],
    bind: [],
  },
  chart: {
    type: "chart",
    label: "Chart",
    create: "lv_chart_create",
    parts: ["main", "items", "indicator"],
    size: [200, 120],
    props: [
      {
        key: "chartType",
        label: "Type",
        type: "enum",
        default: "LV_CHART_TYPE_LINE",
        options: [
          { value: "LV_CHART_TYPE_LINE", label: "Line" },
          { value: "LV_CHART_TYPE_CURVE", label: "Curve" },
          { value: "LV_CHART_TYPE_BAR", label: "Bars" },
        ],
      },
      { key: "points", label: "Points", type: "int", default: 24, min: 2, max: 400 },
      { key: "min", label: "Min", type: "int", default: 0 },
      { key: "max", label: "Max", type: "int", default: 100 },
      { key: "seriesColor", label: "Series color", type: "color", default: "#2196f3" },
    ],
    calls: [
      { fn: "lv_chart_set_type", args: ["chartType"] },
      { fn: "lv_chart_set_point_count", args: ["points"] },
      {
        fn: "lv_chart_set_axis_range",
        args: [{ k: "const", names: ["LV_CHART_AXIS_PRIMARY_Y"] }, "min", "max"],
      },
    ],
    bind: ["series"],
  },
}

/** Widgets offered in the insert menu, in order. */
export const INSERTABLE: WidgetType[] = [
  "container",
  "label",
  "button",
  "image",
  "arc",
  "bar",
  "slider",
  "switch",
  "checkbox",
  "spinner",
  "led",
  "dropdown",
  "roller",
  "scale",
  "chart",
]

/*---------- LVGL's built-in icon glyphs (in every Montserrat font) ----------*/

export const SYMBOLS: { name: string; cp: number }[] = [
  ["AUDIO", 0xf001], ["VIDEO", 0xf008], ["LIST", 0xf00b], ["OK", 0xf00c], ["CLOSE", 0xf00d],
  ["POWER", 0xf011], ["SETTINGS", 0xf013], ["HOME", 0xf015], ["DOWNLOAD", 0xf019], ["DRIVE", 0xf01c],
  ["REFRESH", 0xf021], ["MUTE", 0xf026], ["VOLUME_MID", 0xf027], ["VOLUME_MAX", 0xf028],
  ["IMAGE", 0xf03e], ["TINT", 0xf043], ["PREV", 0xf048], ["PLAY", 0xf04b], ["PAUSE", 0xf04c],
  ["STOP", 0xf04d], ["NEXT", 0xf051], ["EJECT", 0xf052], ["LEFT", 0xf053], ["RIGHT", 0xf054],
  ["PLUS", 0xf067], ["MINUS", 0xf068], ["EYE_OPEN", 0xf06e], ["EYE_CLOSE", 0xf070],
  ["WARNING", 0xf071], ["SHUFFLE", 0xf074], ["UP", 0xf077], ["DOWN", 0xf078], ["LOOP", 0xf079],
  ["DIRECTORY", 0xf07b], ["UPLOAD", 0xf093], ["CALL", 0xf095], ["CUT", 0xf0c4], ["COPY", 0xf0c5],
  ["SAVE", 0xf0c7], ["BARS", 0xf0c9], ["ENVELOPE", 0xf0e0], ["CHARGE", 0xf0e7], ["PASTE", 0xf0ea],
  ["BELL", 0xf0f3], ["KEYBOARD", 0xf11c], ["GPS", 0xf124], ["FILE", 0xf15b], ["WIFI", 0xf1eb],
  ["BATTERY_FULL", 0xf240], ["BATTERY_3", 0xf241], ["BATTERY_2", 0xf242], ["BATTERY_1", 0xf243],
  ["BATTERY_EMPTY", 0xf244], ["USB", 0xf287], ["BLUETOOTH", 0xf293], ["TRASH", 0xf2ed],
  ["EDIT", 0xf304], ["BACKSPACE", 0xf55a], ["SD_CARD", 0xf7c2], ["NEW_LINE", 0xf8a2],
].map(([name, cp]) => ({ name: `LV_SYMBOL_${name}`, cp: cp as number }))
