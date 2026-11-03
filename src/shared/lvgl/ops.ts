/**
 * The op list is Kiln's one description of a UI. The wasm preview executes it and the
 * exporter prints it as C, so the canvas and the firmware can't drift apart.
 * An op is an LVGL call by name; args say how to pass each value in both worlds.
 */

/** px, a percentage of the parent, or LVGL's size-to-content. */
export type Coord = number | `${number}%` | "content"

export type Arg =
  | { k: "obj"; id: string }
  | { k: "int"; v: number }
  | { k: "bool"; v: boolean }
  /** OR-ed enum constants, e.g. LV_PART_INDICATOR | LV_STATE_PRESSED. Empty means 0. */
  | { k: "const"; names: string[] }
  | { k: "coord"; v: Coord }
  | { k: "str"; v: string }
  /** "#rrggbb"; `token` prints the colour as a UI_COLOR_* macro in C */
  | { k: "color"; v: string; token?: string }
  /** An int printed as 0xRRGGBB in C */
  | { k: "hex"; v: number }
  /** a built-in font, by its C name */
  | { k: "font"; name: string }
  /** a font a `tiny_ttf` op made */
  | { k: "tiny_ttf"; id: string }
  | { k: "image"; id: string }
  /** a `frames` op's image array, as lv_animimg_set_src takes it */
  | { k: "frames"; id: string }
  | { k: "subject"; id: string }
  | { k: "style"; id: string }
  | { k: "transition"; id: string }
  | { k: "timeline"; id: string }
  | { k: "series"; id: string }
  /** The scratch lv_anim_t that a block of lv_anim_* calls configures. */
  | { k: "anim" }
  /** A function pointer, optionally cast for C (e.g. lv_anim_exec_xcb_t). */
  | { k: "fn"; name: string; cast?: string }
  | { k: "null" }

export type Op =
  /** `id = fn(parent)`; a null parent makes a screen. */
  | { op: "create"; id: string; fn: string; parent: string | null }
  /** `fn(args)`, optionally keeping the returned pointer as `ret.id`. */
  | { op: "call"; fn: string; args: Arg[]; ret?: { kind: "timeline" | "series"; id: string } }
  | {
      op: "subject"
      id: string
      type: "int" | "string" | "color"
      init: number | string
      min?: number
      max?: number
    }
  /** Declares a shared lv_style_t; lv_style_set_* calls fill it. */
  | { op: "style"; id: string }
  /** A static lv_style_transition_dsc_t. `path` names an lv_anim_path_* function. */
  | { op: "transition"; id: string; props: string[]; path: string; time: number; delay: number }
  /** A const lv_image_dsc_t. `cf` is an LV_COLOR_FORMAT_* name. */
  | { op: "image"; id: string; cf: string; w: number; h: number; stride: number; data: Uint8Array }
  /** An array of pointers to `image` ops' descriptors: a sprite's frames. */
  | { op: "frames"; id: string; images: string[] }
  /** A TTF/OTF file's bytes, which the fonts made from it keep reading. */
  | { op: "ttf"; id: string; data: Uint8Array }
  /**
   * A TinyTTF font at one pixel size, from a `ttf` op's bytes, with an optional built-in font
   * for the glyphs it lacks; LVGL's default font if it can't be made.
   */
  | {
      op: "tiny_ttf"
      id: string
      ttf: string
      size: number
      cache: number
      fallback: string | null
    }

export type ScreenProgram = { id: string; ops: Op[] }

/** Ops grouped by when they can run: setup has no objects yet, wiring needs every screen. */
export type Program = {
  /** C identifier for every id the ops mention. */
  names: Record<string, string>
  setup: Op[]
  screens: ScreenProgram[]
  wiring: Op[]
}

export const obj = (id: string): Arg => ({ k: "obj", id })
export const int = (v: number): Arg => ({ k: "int", v: Math.round(v) })
export const bool = (v: boolean): Arg => ({ k: "bool", v })
export const c = (...names: string[]): Arg => ({ k: "const", names })
export const str = (v: string): Arg => ({ k: "str", v })
export const color = (v: string): Arg => ({ k: "color", v })
export const call = (fn: string, ...args: Arg[]): Op => ({ op: "call", fn, args })
