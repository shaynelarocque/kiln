import { Scene, type Display, type LvglRuntime, type Op, type Rect } from "@/shared/lvgl"
import { compile } from "../lib/compile"
import { parseExpr, type ExprEnv } from "../lib/expr"
import type { Project, Variable } from "./types"

/** Each variable whose C expression Play can run (see parseExpr), keyed by the variable's id. */
export function playableExprs(project: Project, names: Record<string, string>) {
  const ints = project.variables.filter(v => v.type === "int")
  const byName = Object.fromEntries(ints.map(v => [names[v.id], v.id]))
  const exprs = new Map<string, ReturnType<typeof parseExpr>>()
  for (const v of ints)
    if (v.source?.kind === "custom") exprs.set(v.id, parseExpr(v.source.expr, byName))
  return exprs
}

/** A cheap identity for an op list; image bytes are sampled instead of serialised. */
function keyOf(ops: Op[]) {
  return JSON.stringify(ops, (_, v) => {
    if (!(v instanceof Uint8Array)) return v
    let h = 2166136261
    for (let i = 0; i < v.length; i += 7) h = Math.imul(h ^ v[i], 16777619)
    return `bytes:${v.length}:${h}`
  })
}

type Board = { display: Display; scene: Scene | null; key: string }

/**
 * Edit-mode preview: one LVGL display per screen, rebuilt only when that screen's ops change.
 * Events and timelines are left out (see compile's "edit" mode) so the canvas holds still.
 */
export class ProjectPreview {
  private setup: Scene | null = null
  private setupKey = ""
  private boards = new Map<string, Board>()
  /** kept apart from boards: React mounts a canvas before the sync that creates its display */
  private canvases = new Map<string, CanvasRenderingContext2D>()

  constructor(readonly rt: LvglRuntime) {}

  sync(project: Project) {
    const program = compile(project, "edit")
    const { width, height } = project.target.display
    const setupKey = keyOf(program.setup) + JSON.stringify([project.theme, width, height])
    if (setupKey !== this.setupKey) {
      this.dispose()
      this.setup = new Scene(this.rt)
      this.setupKey = setupKey
      this.setup.run(program.setup)
    }
    const live = new Set(program.screens.map(s => s.id))
    for (const [id, board] of this.boards) if (!live.has(id)) this.drop(id, board)
    for (const screen of program.screens) {
      let board = this.boards.get(screen.id)
      const key = keyOf(screen.ops)
      if (board?.key === key) continue
      if (!board) {
        const display = this.rt.createDisplay(width, height)
        display.setTheme(project.theme)
        board = { display, scene: null, key: "" }
        this.boards.set(screen.id, board)
      }
      board.display.release()
      board.scene?.dispose()
      board.display.makeDefault()
      board.scene = new Scene(this.rt, this.setup!)
      board.key = key
      board.scene.run(screen.ops)
      this.rt.x.lv_screen_load(board.scene.screen())
    }
  }

  attach(screenId: string, canvas: HTMLCanvasElement | null) {
    const ctx = canvas?.getContext("2d")
    if (!ctx) return void this.canvases.delete(screenId)
    this.canvases.set(screenId, ctx)
    const screen = this.boards.get(screenId)?.scene?.screen()
    if (screen) this.rt.x.lv_obj_invalidate(screen)
  }

  /** Advance LVGL and paint whatever changed. */
  frame(ms: number) {
    this.rt.tick(ms)
    for (const [id, board] of this.boards) {
      const ctx = this.canvases.get(id)
      if (ctx) board.display.blit(ctx)
    }
  }

  /** Where LVGL laid out every node of a screen, in display pixels. */
  rects(screenId: string) {
    const out = new Map<string, Rect>()
    const scene = this.boards.get(screenId)?.scene
    if (scene)
      for (const [id, h] of scene.objects()) {
        const r: Rect = this.rt.coords(h)
        // bindings can hide parts of a design; clicks shouldn't land on what isn't drawn
        if (!this.rt.x.lv_obj_is_visible(h)) {
          if (this.flagged(h)) r.hidden = true
          else r.clipped = true
        }
        out.set(id, r)
      }
    return out
  }

  /** Whether it or a parent has LVGL's hidden flag, as opposed to just lying off its parent. */
  private flagged(obj: number) {
    const hidden = this.rt.const("LV_OBJ_FLAG_HIDDEN")
    for (let o = obj; o; o = this.rt.x.lv_obj_get_parent(o))
      if (this.rt.x.lv_obj_has_flag(o, hidden)) return true
    return false
  }

  private drop(id: string, board: Board) {
    board.display.release()
    board.scene?.dispose()
    board.display.delete()
    this.boards.delete(id)
  }

  dispose() {
    for (const [id, board] of this.boards) this.drop(id, board)
    this.setup?.dispose()
    this.setup = null
    this.setupKey = ""
  }
}

/** The value a simulated variable has `t` ms into play mode. */
export function simulate(v: Variable, t: number, prev: number): number {
  const { min, max } = v
  const phase = (t % v.sim.period) / v.sim.period
  switch (v.sim.kind) {
    case "sine":
      return Math.round(min + ((max - min) * (1 - Math.cos(phase * 2 * Math.PI))) / 2)
    case "saw":
      return Math.round(min + (max - min) * phase)
    case "square":
      return phase < 0.5 ? max : min
    case "random": {
      // a random walk, about 1/20th of the range per step
      const step = Math.max(1, Math.round((max - min) / 20))
      return Math.min(max, Math.max(min, prev + Math.round((Math.random() * 2 - 1) * step)))
    }
    default:
      return prev
  }
}

/** Play mode: the whole UI on one device-sized display, with events, timelines and simulations. */
export class ProjectPlayer {
  private display: Display
  private setup: Scene
  private scene: Scene
  private time = 0
  private lastSim = -Infinity
  /** C expression sources Play can run, each on its own period like the board's poll */
  private exprs: { id: string; every: number; next: number; run: (env: ExprEnv) => number }[] = []

  constructor(
    readonly rt: LvglRuntime,
    private project: Project,
    startScreen: string,
  ) {
    const program = compile(project, "play")
    for (const [id, parsed] of playableExprs(project, program.names)) {
      const v = project.variables.find(x => x.id === id)!
      if (parsed.ok && v.source?.kind === "custom")
        this.exprs.push({ id, every: Math.max(5, v.source.every), next: 0, run: parsed.run })
    }
    const { width, height } = project.target.display
    this.display = rt.createDisplay(width, height)
    this.display.setTheme(project.theme)
    this.display.makeDefault()
    this.setup = new Scene(rt)
    this.setup.run(program.setup)
    this.scene = new Scene(rt, this.setup)
    for (const s of program.screens) this.scene.run(s.ops)
    this.scene.run(program.wiring)
    const index = Math.max(
      0,
      program.screens.findIndex(s => s.id === startScreen),
    )
    rt.x.lv_screen_load(this.scene.screen(index))
  }

  get width() {
    return this.display.width
  }

  get height() {
    return this.display.height
  }

  pointer(x: number, y: number, pressed: boolean) {
    this.display.pointer(x, y, pressed)
  }

  /** A physical button going down or up; `key` is its LVGL key name. */
  key(key: string, pressed: boolean) {
    this.display.key(key, pressed)
  }

  /** Simulations step at 20 Hz, like a sensor poll would; LVGL ticks every frame. */
  frame(ms: number, ctx: CanvasRenderingContext2D) {
    this.time += ms
    if (this.time - this.lastSim >= 50) {
      this.lastSim = this.time
      // a simulation stands in for a source; an expression Play can run is the real thing
      for (const v of this.project.variables)
        if (v.type === "int" && v.sim.kind !== "none" && !this.exprs.some(e => e.id === v.id))
          this.set(v.id, simulate(v, this.time, this.get(v.id)))
    }
    // in declaration order, each seeing the values set before it, as the board's loop does
    for (const e of this.exprs)
      if (this.time >= e.next) {
        e.next = this.time + e.every
        this.set(e.id, e.run({ get: id => this.get(id), now: this.time, random: Math.random }))
      }
    this.rt.tick(ms)
    this.display.blit(ctx)
  }

  get(variableId: string) {
    const h = this.setup.get("subject", variableId)
    return h ? this.rt.x.lv_subject_get_int(h) : 0
  }

  set(variableId: string, value: number) {
    const h = this.setup.get("subject", variableId)
    if (h && this.rt.x.lv_subject_get_int(h) !== value)
      this.rt.x.lv_subject_set_int(h, Math.round(value))
  }

  /** Starts an animation from the top, e.g. to preview it from the timeline. */
  play(animationId: string) {
    const tl = this.scene.get("timeline", animationId)
    if (!tl) return
    this.rt.x.lv_anim_timeline_set_progress(tl, 0)
    this.rt.x.lv_anim_timeline_start(tl)
  }

  activeScreen() {
    const active = this.rt.x.lv_display_get_screen_active(this.display.ptr)
    return [...this.scene.objects()].find(([, h]) => h === active)?.[0]
  }

  dispose() {
    this.display.release()
    this.scene.dispose()
    this.setup.dispose()
    this.display.delete()
  }
}
