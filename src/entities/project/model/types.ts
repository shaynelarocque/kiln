import type { Coord, Easing, WidgetType } from "@/shared/lvgl"

/**
 * A Kiln project file. Values are stored in LVGL's own units (opacity 0-255, rotation in
 * tenths of a degree, scale 256 = 100%) so compiling is a straight copy; the inspector converts.
 */
export type Project = {
  kiln: 1
  name: string
  target: Target
  theme: Theme
  screens: Screen[]
  variables: Variable[]
  styles: SharedStyle[]
  tokens: Token[]
  animations: Animation[]
  assets: Asset[]
  fonts: FontAsset[]
  /** frame animations: a GIF, a strip or numbered images, one LVGL image per frame */
  sprites: Sprite[]
  /** other displays the same UI is built for, like CSS breakpoints (see atSize) */
  sizes: Size[]
}

/** Another display for the same UI: its own board and panel, plus what nodes change there. */
export type Size = { id: string; name: string; target: Target }

/** What one node changes at one size. A null style prop or layout field is removed there. */
export type SizePatch = {
  layout?: { [K in keyof Layout]?: Layout[K] | null }
  style?: Record<string, Record<string, StyleValue | null>>
  hidden?: boolean
}

export type Theme = { primary: string; secondary: string; dark: boolean }

/** A colour variable: style values written "$<token id>" resolve to it. */
export type Token = { id: string; name: string; value: string }

/** Like a CSS class: a named lv_style_t that nodes add per selector. */
export type SharedStyle = { id: string; name: string; props: StyleProps }

/** Colours ("#rrggbb" or "$token"), numbers, LV_* enum names, font names, asset ids, booleans. */
export type StyleValue = string | number | boolean
export type StyleProps = Record<string, StyleValue>
/** Keyed by selector, "part:state" like "main:default" or "indicator:checked+pressed". */
export type StyleMap = Record<string, StyleProps>

export type Flex = { flow: string; main: string; cross: string; track: string }

export type Layout = {
  /** offset from the align point */
  x: Coord
  y: Coord
  w: Coord
  h: Coord
  /** LV_ALIGN_* */
  align: string
  /** lays children out like CSS flexbox */
  flex?: Flex
  /** flex-grow inside a flex parent */
  grow?: number
}

export type Compare = "eq" | "not_eq" | "gt" | "ge" | "lt" | "le"

export type Binding =
  | { kind: "text"; variable: string; format: string }
  | { kind: "value"; variable: string }
  | { kind: "checked"; variable: string }
  | { kind: "series"; variable: string }
  | { kind: "flag"; variable: string; flag: string; compare: Compare; ref: number }
  | { kind: "state"; variable: string; state: string; compare: Compare; ref: number }
  /** maps the variable from [inMin, inMax] to [outMin, outMax] and sets a style prop */
  | {
      kind: "style"
      variable: string
      prop: string
      selector: string
      inMin: number
      inMax: number
      outMin: number
      outMax: number
    }

export type Action =
  | { type: "navigate"; screen: string; anim: string; duration: number; delay: number }
  | { type: "set"; variable: string; value: number }
  | { type: "increment"; variable: string; step: number }
  | { type: "toggle"; variable: string }
  | { type: "play"; animation: string; reverse: boolean; delay: number }

/** `trigger` is an LV_EVENT_* name. */
export type Interaction = { id: string; trigger: string; action: Action }

/** Like a CSS transition: animates these style props whenever the node changes state. */
export type Transition = { props: string[]; duration: number; delay: number; easing: Easing }

export type Node = {
  id: string
  name: string
  widget: WidgetType
  props: Record<string, string | number | boolean | null>
  layout: Layout
  style: StyleMap
  classes: { style: string; selector: string }[]
  hidden?: boolean
  checked?: boolean
  disabled?: boolean
  checkable?: boolean
  /** undefined keeps LVGL's per-widget default */
  clickable?: boolean
  /** containers clip instead of scrolling unless this is on */
  scrollable?: boolean
  bindings: Binding[]
  events: Interaction[]
  transition?: Transition
  children: Node[]
  /** editor only: can't be selected on the canvas */
  locked?: boolean
  /** on an instance: the id of its main component (a node on the Components screen) */
  component?: string
  /** on an instance: changes to the main's nodes, keyed by their ids */
  overrides?: Record<string, Override>
  /** per size id: how this node's layout, style and visibility differ at that size */
  at?: Record<string, SizePatch>
}

/** What an instance changes about one node of its main component. */
export type Override = {
  props?: Record<string, string | number | boolean | null>
  /** reads this variable instead, in every binding on that node */
  variable?: string
}

/** A screen is a node with a spot on the infinite canvas. */
export type Screen = Node & {
  widget: "screen"
  frame: { x: number; y: number }
  /** the Components screen: shown on the canvas for editing, never exported */
  library?: boolean
}

export type Simulation = {
  kind: "none" | "sine" | "saw" | "square" | "random"
  /** ms per cycle */
  period: number
}

/** Where a variable's value comes from on the board. `every` is the poll period in ms. */
export type Source =
  | { kind: "analog"; pin: number; inMin: number; inMax: number; every: number }
  | { kind: "digital"; pin: number; pull: "up" | "down" | "none"; invert: boolean; every: number }
  | { kind: "uptime"; every: number }
  | { kind: "heap"; every: number }
  | { kind: "temperature"; every: number }
  | { kind: "custom"; expr: string; every: number }

/** Where a variable's value goes on the board when it changes. */
export type Sink = { kind: "digital"; pin: number; invert: boolean } | { kind: "pwm"; pin: number }

export type Variable = {
  id: string
  name: string
  type: "int" | "string"
  initial: number | string
  min: number
  max: number
  sim: Simulation
  source: Source | null
  sink: Sink | null
}

export type Keyframe = { t: number; value: number | string; easing: Easing }
export type Track = { id: string; node: string; prop: string; keyframes: Keyframe[] }

/** A keyframe timeline (lv_anim_timeline_t). Colour tracks hold "#rrggbb" values. */
export type Animation = {
  id: string
  name: string
  tracks: Track[]
  /** extra plays after the first; -1 repeats forever */
  repeat: number
  /** plays back and forth, like animation-direction: alternate */
  alternate: boolean
  delay: number
  /** start when the screen holding the first track loads */
  autoplay: boolean
}

export type ImageFormat = "RGB565" | "RGB565A8" | "ARGB8888"

export type Asset = {
  id: string
  name: string
  width: number
  height: number
  format: ImageFormat
  dither: boolean
  /** source image as a data: URL, kept to re-convert when the format changes */
  png: string
  /** LVGL pixel data in `format`, base64 */
  data: string
  stride: number
}

/**
 * An imported TTF/OTF file. Styles use it at any size as `ttf:<id>:<px>`, and TinyTTF draws it,
 * on the canvas and on the board alike.
 */
export type FontAsset = {
  id: string
  name: string
  /** the font file, base64 */
  data: string
}

/** A frame animation: one LVGL image per frame, all the same size and format. */
export type Sprite = {
  id: string
  name: string
  width: number
  height: number
  format: ImageFormat
  dither: boolean
  /** how long each frame shows, in ms (from the GIF, or set by hand) */
  frameMs: number
  stride: number
  /** each frame's source as a data: URL (to re-convert) and its LVGL pixel data, base64 */
  frames: { png: string; data: string }[]
}

export type DisplayDriver = "st7789" | "ili9341" | "st7735" | "st7796" | "gc9a01"

export type Pins = { sck: number; mosi: number; cs: number; dc: number; rst: number; bl: number }

export type DisplayConfig = {
  driver: DisplayDriver
  width: number
  height: number
  round: boolean
  /** panel-level colour inversion (most ST7789 and GC9A01 modules need it) */
  invert: boolean
  /** swap red and blue, for panels wired BGR */
  bgr: boolean
  /** quarter turns, 0-3; width/height are the size after rotating */
  rotation: number
  offsetX: number
  offsetY: number
  spiMHz: number
  pins: Pins
  /** rows in each of the two partial render buffers */
  bufferRows: number
}

export type Target = {
  /** a PlatformIO board id, e.g. esp32-c3-devkitm-1 */
  board: string
  display: DisplayConfig
}
