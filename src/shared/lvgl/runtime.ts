import { DEFAULT_FONT, stylePropConst } from "./catalog"
import type { Arg, Op } from "./ops"

type Fn = (...args: number[]) => number
type Exports = Record<string, Fn> & { memory: WebAssembly.Memory }

/** A laid-out box in display pixels; `hidden` when LVGL isn't drawing it right now (its own or a parent's flag). */
export type Rect = { x: number; y: number; w: number; h: number; hidden?: boolean }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** LVGL 9.6 compiled to wasm (runtime/build.sh). One instance can drive several displays. */
export class LvglRuntime {
  private consts = new Map<string, number>()
  private fns = new Map<string, number>()
  private fonts = new Map<string, number>()
  private scratch: number

  private constructor(readonly x: Exports) {
    x.kiln_init()
    this.scratch = x.lv_malloc(64)
  }

  /** `source` is the wasm URL in the app, or its bytes in tests. */
  static async load(source: string | BufferSource, log = (msg: string) => console.warn(msg)) {
    let memory: WebAssembly.Memory | undefined
    const imports = {
      env: { kiln_log: (p: number) => log(readCstr(memory!, p).trim()) },
    }
    const { instance } =
      typeof source === "string"
        ? await WebAssembly.instantiateStreaming(fetch(source), imports)
        : await WebAssembly.instantiate(source, imports)
    const x = instance.exports as unknown as Exports
    memory = x.memory
    return new LvglRuntime(x)
  }

  get memory() {
    return this.x.memory.buffer
  }

  /** A NUL-terminated UTF-8 copy of `s` on the LVGL heap; free it with lv_free. */
  cstr(s: string) {
    const bytes = encoder.encode(s + "\0")
    const p = this.x.lv_malloc(bytes.length)
    new Uint8Array(this.memory, p, bytes.length).set(bytes)
    return p
  }

  /** Looks a name up through a kiln_* table, caching the answer. */
  private lookup(cache: Map<string, number>, name: string, find: (p: number) => number) {
    let v = cache.get(name)
    if (v === undefined) {
      const p = this.cstr(name)
      v = find(p)
      this.x.lv_free(p)
      cache.set(name, v)
    }
    return v
  }

  const(name: string) {
    return this.lookup(this.consts, name, p => {
      if (!this.x.kiln_const(p, this.scratch))
        throw new Error(
          `${name} isn't in the preview runtime's constant table (rebuild it: pnpm run runtime)`,
        )
      return new Int32Array(this.memory, this.scratch, 1)[0]
    })
  }

  fn(name: string) {
    return this.lookup(this.fns, name, p => {
      const f = this.x.kiln_fn(p)
      if (!f) throw new Error(`${name} isn't in the preview runtime's function table`)
      return f
    })
  }

  font(name: string) {
    return this.lookup(this.fonts, name, p => {
      const f = this.x.kiln_font(p)
      if (!f) throw new Error(`Font ${name} isn't compiled into the preview runtime`)
      return f
    })
  }

  /** Advance LVGL's clock and run its timers: redraws, animations, input. */
  tick(ms: number) {
    this.x.lv_tick_inc(Math.max(0, Math.round(ms)))
    this.x.lv_timer_handler()
  }

  createDisplay(width: number, height: number) {
    return new Display(this, this.x.kiln_display_create(width, height), width, height)
  }

  /** Absolute box of an object on its display, after layout. */
  /** Whether TinyTTF can open these bytes as a font (an import check: it trusts what it's given). */
  canReadFont(data: Uint8Array) {
    const p = this.x.lv_malloc(data.length)
    new Uint8Array(this.memory, p, data.length).set(data)
    const font = this.x.lv_tiny_ttf_create_data_ex(
      p,
      data.length,
      16,
      this.const("LV_FONT_KERNING_NORMAL"),
      1,
    )
    if (font) this.x.lv_tiny_ttf_destroy(font)
    this.x.lv_free(p)
    return Boolean(font)
  }

  coords(obj: number): Rect {
    this.x.lv_obj_update_layout(obj)
    this.x.lv_obj_get_coords(obj, this.scratch)
    const [x1, y1, x2, y2] = new Int32Array(this.memory, this.scratch, 4)
    return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 }
  }

  readArea(): [number, number, number, number] {
    const [x1, y1, x2, y2] = new Int32Array(this.memory, this.scratch, 4)
    return [x1, y1, x2, y2]
  }

  get scratchPtr() {
    return this.scratch
  }
}

function readCstr(memory: WebAssembly.Memory, p: number) {
  const u8 = new Uint8Array(memory.buffer)
  let end = p
  while (u8[end]) end++
  return decoder.decode(u8.subarray(p, end))
}

export type Theme = { primary: string; secondary: string; dark: boolean }

const hex = (color: string) => parseInt(color.slice(1), 16)

export class Display {
  /** the screen LVGL made with the display, to fall back to before ours are deleted */
  private initial: number

  constructor(
    private rt: LvglRuntime,
    readonly ptr: number,
    readonly width: number,
    readonly height: number,
  ) {
    this.initial = rt.x.lv_display_get_screen_active(ptr)
  }

  /** Show the blank initial screen, so the active one can be deleted cleanly. */
  release() {
    this.rt.x.lv_screen_load(this.initial)
  }

  /** Must run before creating screens: LVGL applies the theme when a widget is created. */
  setTheme(theme: Theme) {
    this.rt.x.kiln_display_theme(this.ptr, hex(theme.primary), hex(theme.secondary), +theme.dark)
  }

  /** Make this the display new screens are created on. */
  makeDefault() {
    this.rt.x.lv_display_set_default(this.ptr)
  }

  /** Copy whatever LVGL redrew since the last call onto `ctx`. Returns false when nothing changed. */
  blit(ctx: CanvasRenderingContext2D) {
    if (!this.rt.x.kiln_display_take_dirty(this.ptr, this.rt.scratchPtr)) return false
    const [x1, y1, x2, y2] = this.rt.readArea()
    const offset = this.rt.x.kiln_display_rgba(this.ptr)
    const rgba = new Uint8ClampedArray(this.rt.memory, offset, this.width * this.height * 4)
    ctx.putImageData(new ImageData(rgba, this.width), 0, 0, x1, y1, x2 - x1 + 1, y2 - y1 + 1)
    return true
  }

  /** The RGBA framebuffer, for tests and thumbnails. */
  pixels() {
    const offset = this.rt.x.kiln_display_rgba(this.ptr)
    return new Uint8Array(this.rt.memory, offset, this.width * this.height * 4).slice()
  }

  pointer(x: number, y: number, pressed: boolean) {
    this.rt.x.kiln_pointer(this.ptr, Math.round(x), Math.round(y), +pressed)
  }

  delete() {
    this.rt.x.kiln_display_delete(this.ptr)
  }
}

type Kind =
  "obj" | "subject" | "style" | "transition" | "image" | "ttf" | "tiny_ttf" | "timeline" | "series"

/**
 * Executes ops on the runtime and owns what they create. A screen scene points at the
 * setup scene (its parent) for shared subjects, styles and images.
 */
export class Scene {
  private handles = new Map<string, number>()
  private screens: number[] = []
  private timelines: number[] = []
  private styles: number[] = []
  private subjects: number[] = []
  private blocks: number[] = []
  private images: number[] = []
  private fonts: number[] = []
  private ttfBytes = new Map<string, number>()
  private anim = 0

  constructor(
    private rt: LvglRuntime,
    private parent?: Scene,
  ) {}

  /** Runs ops in order. A failing op throws with its name; the runtime may need reloading after a trap. */
  run(ops: Op[]) {
    for (const op of ops) {
      try {
        this.exec(op)
      } catch (e) {
        const what = op.op === "call" || op.op === "create" ? op.fn : `${op.op} ${op.id}`
        throw new Error(`${what}: ${e instanceof Error ? e.message : e}`, { cause: e })
      }
    }
  }

  get(kind: Kind, id: string): number | undefined {
    return this.handles.get(`${kind}:${id}`) ?? this.parent?.get(kind, id)
  }

  /** Every object this scene created, by node id. */
  objects() {
    const out = new Map<string, number>()
    for (const [key, h] of this.handles) if (key.startsWith("obj:")) out.set(key.slice(4), h)
    return out
  }

  screen(index = 0) {
    return this.screens[index]
  }

  private set(kind: Kind, id: string, h: number) {
    this.handles.set(`${kind}:${id}`, h)
  }

  private need(kind: Kind, id: string) {
    const h = this.get(kind, id)
    if (h === undefined) throw new Error(`no ${kind} "${id}"`)
    return h
  }

  private exec(op: Op) {
    const { x } = this.rt
    switch (op.op) {
      case "create": {
        const fn = x[op.fn]
        if (!fn) throw new Error("not in the preview runtime")
        const h = fn(op.parent ? this.need("obj", op.parent) : 0)
        this.set("obj", op.id, h)
        if (!op.parent) this.screens.push(h)
        return
      }
      case "call":
        return this.call(op.fn, op.args, op.ret)
      case "subject": {
        const type = {
          int: "LV_SUBJECT_TYPE_INT",
          string: "LV_SUBJECT_TYPE_STRING",
          color: "LV_SUBJECT_TYPE_COLOR",
        }[op.type]
        const h = x.lv_subject_create(this.rt.const(type))
        if (op.type === "string") {
          // the generated code uses two static 64-byte buffers; these stand in for them
          const buf = x.lv_malloc(64)
          const prev = x.lv_malloc(64)
          this.blocks.push(buf, prev)
          x.lv_subject_set_string_buffer_static(h, buf, prev, 64)
          const p = this.rt.cstr(String(op.init))
          x.lv_subject_set_string(h, p)
          x.lv_free(p)
        } else if (op.type === "color") x.kiln__lv_subject_set_color(h, hex(String(op.init)))
        else {
          if (op.min !== undefined) x.lv_subject_set_min_value_int(h, op.min)
          if (op.max !== undefined) x.lv_subject_set_max_value_int(h, op.max)
          x.lv_subject_set_int(h, Number(op.init))
        }
        this.subjects.push(h)
        return this.set("subject", op.id, h)
      }
      case "style": {
        const h = x.kiln_style_new()
        this.styles.push(h)
        return this.set("style", op.id, h)
      }
      case "transition": {
        const props = x.lv_malloc(op.props.length * 4)
        new Int32Array(this.rt.memory, props, op.props.length).set(
          op.props.map(n => this.rt.const(n)),
        )
        const h = x.kiln_transition_new(
          props,
          op.props.length,
          this.rt.fn(op.path),
          op.time,
          op.delay,
        )
        x.lv_free(props)
        this.blocks.push(h)
        return this.set("transition", op.id, h)
      }
      case "image": {
        const data = x.lv_malloc(op.data.length)
        new Uint8Array(this.rt.memory, data, op.data.length).set(op.data)
        const h = x.kiln_image_new(
          this.rt.const(op.cf),
          op.w,
          op.h,
          op.stride,
          data,
          op.data.length,
        )
        this.images.push(h)
        return this.set("image", op.id, h)
      }
      case "ttf": {
        // TinyTTF reads glyphs from these bytes for as long as its fonts live
        const data = x.lv_malloc(op.data.length)
        new Uint8Array(this.rt.memory, data, op.data.length).set(op.data)
        this.blocks.push(data)
        this.ttfBytes.set(op.id, op.data.length)
        return this.set("ttf", op.id, data)
      }
      case "tiny_ttf": {
        const fallback = op.fallback ? this.rt.font(op.fallback) : 0
        const h = x.kiln_tiny_ttf(
          this.need("ttf", op.ttf),
          this.ttfBytes.get(op.ttf) ?? 0,
          op.size,
          op.cache,
          fallback,
        )
        // the helper hands back LVGL's default font when TinyTTF can't: the UI stays up in it
        if (h === this.rt.font(DEFAULT_FONT))
          console.warn(`Kiln: TinyTTF couldn't read font ${op.ttf}; using ${DEFAULT_FONT}`)
        else this.fonts.push(h)
        return this.set("tiny_ttf", op.id, h)
      }
    }
  }

  private call(name: string, args: Arg[], ret?: { kind: "timeline" | "series"; id: string }) {
    const { x } = this.rt
    // lv_obj_set_style_<prop>(obj, value, selector) and lv_style_set_<prop>(style, value)
    // pass lv_style_value_t by value in C, so they go through kiln_*_style_{num,color,ptr}.
    const local = /^lv_obj_set_style_(\w+)$/.exec(name)
    const shared = /^lv_style_set_(\w+)$/.exec(name)
    if (local || shared) {
      const prop = this.rt.const(stylePropConst((local ?? shared)![1]))
      const value = args[1]
      const kind =
        value.k === "color"
          ? "color"
          : ["font", "tiny_ttf", "image", "transition", "str"].includes(value.k)
            ? "ptr"
            : "num"
      const target = this.arg(args[0])
      if (local) x[`kiln_obj_style_${kind}`](target, prop, this.arg(value), this.arg(args[2]))
      else x[`kiln_style_${kind}`](target, prop, this.arg(value))
      return
    }
    const fnName = args.some(a => a.k === "color") ? `kiln__${name}` : name
    const fn = x[fnName]
    if (!fn) throw new Error("not in the preview runtime")
    const h = fn(...args.map(a => this.arg(a)))
    if (ret) {
      if (ret.kind === "timeline") this.timelines.push(h)
      this.set(ret.kind, ret.id, h)
    }
  }

  private arg(a: Arg): number {
    const { x } = this.rt
    switch (a.k) {
      case "obj":
      case "subject":
      case "style":
      case "transition":
      case "image":
      case "tiny_ttf":
      case "timeline":
      case "series":
        return this.need(a.k, a.id)
      case "int":
        return a.v
      case "bool":
        return a.v ? 1 : 0
      case "const":
        return a.names.reduce((acc, n) => acc | this.rt.const(n), 0)
      case "coord":
        if (typeof a.v === "number") return Math.round(a.v)
        return a.v === "content"
          ? this.rt.const("LV_SIZE_CONTENT")
          : x.lv_pct(Math.round(parseFloat(a.v)))
      case "str": {
        // Kept until dispose: lv_label_bind_text and friends hold on to the pointer.
        const p = this.rt.cstr(a.v)
        this.blocks.push(p)
        return p
      }
      case "color":
        return hex(a.v)
      case "hex":
        return a.v
      case "font":
        return this.rt.font(a.name)
      case "anim":
        return (this.anim ||= x.kiln_anim_new())
      case "fn":
        return this.rt.fn(a.name)
      case "null":
        return 0
    }
  }

  /** Frees everything this scene made. Dispose screen scenes before the setup scene they use. */
  dispose() {
    const { x } = this.rt
    for (const tl of this.timelines) x.lv_anim_timeline_delete(tl)
    for (const scr of this.screens) x.lv_obj_delete(scr)
    for (const s of this.styles) x.kiln_style_free(s)
    for (const s of this.subjects) x.lv_subject_delete(s)
    for (const i of this.images) x.kiln_image_free(i)
    // after the screens and styles that use them, before the bytes they read
    for (const f of this.fonts) x.lv_tiny_ttf_destroy(f)
    for (const b of this.blocks) x.lv_free(b)
    if (this.anim) x.lv_free(this.anim)
    this.handles.clear()
    this.screens =
      this.timelines =
      this.styles =
      this.subjects =
      this.images =
      this.fonts =
      this.blocks =
        []
    this.ttfBytes.clear()
    this.anim = 0
  }
}
