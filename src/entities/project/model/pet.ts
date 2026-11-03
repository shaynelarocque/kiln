import {
  createAnimation,
  createNode,
  createScreen,
  createVariable,
  DEFAULT_DISPLAY,
  newId,
} from "./factory"
import type { Easing } from "@/shared/lvgl"
import type {
  Animation,
  Binding,
  Compare,
  Keyframe,
  Layout,
  Node,
  Project,
  Size,
  SizePatch,
} from "./types"

const MINT = "#7ee0b5"
const PINK = "#ff7aa8"
const INK = "#17302a"
const NIGHT = "#12162a"
const CREAM = "#e9edf7"
const MUTED = "#8a93ad"
const GOLD = "#ffd166"

const NO_PAD = { pad_top: 0, pad_bottom: 0, pad_left: 0, pad_right: 0 }

const hiddenWhen = (variable: string, compare: Compare, ref: number): Binding => ({
  kind: "flag",
  variable,
  flag: "LV_OBJ_FLAG_HIDDEN",
  compare,
  ref,
})

/** A transparent box the size of its parent: for grouping what shows and hides together. */
const group = (name: string, extra: Partial<Node> = {}) =>
  createNode("container", {
    name,
    layout: { x: 0, y: 0, w: "100%", h: "100%", align: "LV_ALIGN_CENTER" },
    style: { "main:default": { bg_opa: 0, border_width: 0, ...NO_PAD } },
    clickable: false,
    ...extra,
  })

const text = (
  name: string,
  value: string,
  font: string,
  color: string,
  layout: Partial<Layout> = {},
  extra: Partial<Node> = {},
) =>
  createNode("label", {
    name,
    props: { text: value, longMode: "LV_LABEL_LONG_MODE_WRAP" },
    layout: { x: 0, y: 0, w: "content", h: "content", align: "LV_ALIGN_CENTER", ...layout },
    style: {
      "main:default": { text_font: font, text_color: color, text_align: "LV_TEXT_ALIGN_CENTER" },
    },
    ...extra,
  })

/** A filled circle or pill, sized in % of its parent so it scales with the pet. */
const blob = (name: string, color: string, layout: Partial<Layout>, extra: Partial<Node> = {}) =>
  createNode("container", {
    name,
    layout: { x: 0, y: 0, w: "10%", h: "10%", align: "LV_ALIGN_CENTER", ...layout },
    style: {
      "main:default": { bg_color: color, bg_opa: 255, radius: 999, border_width: 0, ...NO_PAD },
    },
    clickable: false,
    ...extra,
  })

const keyframes = (...frames: [number, number | string, Easing][]): Keyframe[] =>
  frames.map(([t, value, easing]) => ({ t, value, easing }))

/**
 * Michael's first idea: a breathalyzer tamagotchi. An MQ-3 alcohol sensor on an ADC pin feeds
 * `booze` (0-100), and the pet's face, blush and words follow it; tap it for a boop. Laid out
 * in percentages on a round 240×240 screen, with a 128×160 ST7735 size that only needs a few
 * font and size overrides.
 */
export function createPetProject(): Project {
  const display = DEFAULT_DISPLAY
  const small: Size = {
    id: newId(),
    name: "128×160",
    // the common 1.8″ ST7735 module (entities/board's preset; entities don't import each other)
    target: {
      board: "esp32-c3-devkitm-1",
      display: {
        ...display,
        driver: "st7735",
        width: 128,
        height: 160,
        round: false,
        invert: false,
        bgr: false,
      },
    },
  }
  const at = (patch: SizePatch) => ({ [small.id]: patch })
  const smallFont = (font: string) => at({ style: { "main:default": { text_font: font } } })

  const booze = createVariable("booze", {
    initial: 12,
    min: 0,
    max: 100,
    sim: { kind: "sine", period: 14000 },
    source: { kind: "analog", pin: 0, inMin: 300, inMax: 3200, every: 200 },
  })
  const alarm = createVariable("alarm", {
    initial: 0,
    min: 0,
    max: 1,
    source: { kind: "custom", expr: "lv_subject_get_int(ui_var_booze) > 70", every: 250 },
    sink: { kind: "digital", pin: 1, invert: false },
  })

  // the face: one per mood, picked by nesting single-threshold visibility bindings
  const eye = (name: string, x: Layout["x"]) =>
    blob(name, INK, { x, y: "-12%", w: "10%", h: "17%" })
  const eyes = [eye("eye_l", "-20%"), eye("eye_r", "20%")]
  const smile = createNode("arc", {
    name: "smile",
    props: {
      min: 0,
      max: 100,
      value: 0,
      bgStart: 25,
      bgEnd: 155,
      rotation: 0,
      mode: "LV_ARC_MODE_NORMAL",
    },
    layout: { x: 0, y: "2%", w: "36%", h: "36%", align: "LV_ALIGN_CENTER" },
    style: {
      "main:default": { arc_width: 4, arc_color: INK, arc_rounded: true, ...NO_PAD },
      "indicator:default": { arc_opa: 0 },
      "knob:default": { bg_opa: 0 },
    },
    clickable: false,
  })
  const sober = group("sober_face", {
    bindings: [hiddenWhen(booze.id, "gt", 30)],
    children: [...eyes, smile],
  })
  const tipsyFace = group("tipsy_face", {
    bindings: [hiddenWhen(booze.id, "le", 30)],
    children: [
      text(
        "tipsy_eyes",
        "^    ^",
        "lv_font_montserrat_22",
        INK,
        { y: "-12%" },
        { at: smallFont("lv_font_montserrat_12") },
      ),
      text(
        "tipsy_mouth",
        "~",
        "lv_font_montserrat_28",
        INK,
        { y: "8%" },
        { at: smallFont("lv_font_montserrat_16") },
      ),
    ],
  })
  const tipsy = group("tipsy", {
    bindings: [hiddenWhen(booze.id, "gt", 70)],
    children: [tipsyFace],
  })
  const wasted = group("wasted_face", {
    bindings: [hiddenWhen(booze.id, "le", 70)],
    children: [
      text(
        "x_eyes",
        "x    x",
        "lv_font_montserrat_22",
        INK,
        { y: "-12%" },
        { at: smallFont("lv_font_montserrat_12") },
      ),
      text(
        "o_mouth",
        "o",
        "lv_font_montserrat_20",
        INK,
        { y: "8%" },
        { at: smallFont("lv_font_montserrat_12") },
      ),
    ],
  })
  const cheek = (name: string, x: Layout["x"]) =>
    blob(
      name,
      PINK,
      { x, y: "6%", w: "14%", h: "8%" },
      {
        style: {
          "main:default": { bg_color: PINK, bg_opa: 0, radius: 999, border_width: 0, ...NO_PAD },
        },
        bindings: [
          {
            kind: "style",
            variable: booze.id,
            prop: "bg_opa",
            selector: "main:default",
            inMin: 20,
            inMax: 80,
            outMin: 0,
            outMax: 230,
          },
        ],
      },
    )

  const body = createNode("container", {
    name: "body",
    layout: { x: 0, y: 0, w: "100%", h: "86%", align: "LV_ALIGN_BOTTOM_MID" },
    style: {
      "main:default": {
        bg_color: MINT,
        bg_opa: 255,
        bg_grad_color: "#5fcf9f",
        bg_grad_dir: "LV_GRAD_DIR_VER",
        radius: 999,
        border_width: 3,
        border_color: "#4fb88b",
        ...NO_PAD,
      },
    },
    clickable: false,
    children: [cheek("cheek_l", "-30%"), cheek("cheek_r", "30%"), sober, tipsy, wasted],
  })
  const antenna = (name: string, x: Layout["x"]) =>
    blob(
      name,
      MINT,
      { x, y: "1%", w: "15%", h: "15%", align: "LV_ALIGN_TOP_MID" },
      {
        style: {
          "main:default": {
            bg_color: MINT,
            bg_opa: 255,
            radius: 999,
            border_width: 3,
            border_color: "#4fb88b",
            ...NO_PAD,
          },
        },
      },
    )
  // the whole pet bounces and boops; it scales about its middle, which moves with the size
  const buddy = group("buddy", {
    layout: { x: 0, y: "-8%", w: "48%", h: "48%", align: "LV_ALIGN_CENTER" },
    style: {
      "main:default": {
        bg_opa: 0,
        border_width: 0,
        ...NO_PAD,
        transform_pivot_x: 58,
        transform_pivot_y: 58,
      },
    },
    clickable: true,
    children: [antenna("antenna_l", "-24%"), antenna("antenna_r", "24%"), body],
    at: at({ style: { "main:default": { transform_pivot_x: 31, transform_pivot_y: 38 } } }),
  })

  const dizzy = text(
    "dizzy",
    "",
    "lv_font_montserrat_20",
    GOLD,
    { y: "-40%" },
    {
      bindings: [hiddenWhen(booze.id, "le", 70)],
      style: {
        "main:default": {
          text_font: "lv_font_montserrat_20",
          text_color: GOLD,
          transform_pivot_x: 10,
          transform_pivot_y: 11,
        },
      },
      at: at({
        style: {
          "main:default": {
            text_font: "lv_font_montserrat_14",
            transform_pivot_x: 7,
            transform_pivot_y: 8,
          },
        },
      }),
    },
  )
  const say = (name: string, words: string, extra: Partial<Node>) =>
    text(
      name,
      words,
      "lv_font_montserrat_16",
      CREAM,
      { y: "22%" },
      { at: smallFont("lv_font_montserrat_12"), ...extra },
    )
  const sayTipsy = group("say_tipsy", {
    bindings: [hiddenWhen(booze.id, "gt", 70)],
    children: [say("say_hic", "hic! one more?", { bindings: [hiddenWhen(booze.id, "le", 30)] })],
  })
  const meter = createNode("bar", {
    name: "meter",
    props: { min: 0, max: 100, value: 12, mode: "LV_BAR_MODE_NORMAL" },
    layout: { x: 0, y: "29%", w: "40%", h: 8, align: "LV_ALIGN_CENTER" },
    style: {
      "main:default": { bg_color: "#262d48", bg_opa: 255, radius: 4 },
      "indicator:default": {
        bg_color: MINT,
        bg_grad_color: PINK,
        bg_grad_dir: "LV_GRAD_DIR_HOR",
        radius: 4,
      },
    },
    bindings: [{ kind: "value", variable: booze.id }],
    at: at({ layout: { h: 5 } }),
  })
  const pill = (name: string, words: string, extra: Partial<Node>) =>
    createNode("button", {
      name,
      layout: { x: 0, y: -12, w: 78, h: 28, align: "LV_ALIGN_BOTTOM_MID" },
      style: {
        "main:default": { bg_color: PINK, radius: 14, shadow_width: 0 },
        "main:pressed": { bg_color: "#ff5c93" },
      },
      transition: { props: ["bg_color"], duration: 120, delay: 0, easing: "ease-out" },
      at: at({ layout: { y: -6, w: 62, h: 22 } }),
      children: [
        text(
          `${name}_label`,
          words,
          "lv_font_montserrat_16",
          NIGHT,
          {},
          { at: smallFont("lv_font_montserrat_12") },
        ),
      ],
      ...extra,
    })
  const blow = pill("blow_button", "blow!", {})

  const pet = createScreen("Pet", display, { x: 0, y: 0 })
  pet.style = {
    "main:default": { bg_color: NIGHT, bg_grad_color: "#1d2442", bg_grad_dir: "LV_GRAD_DIR_VER" },
  }
  pet.children = [
    dizzy,
    buddy,
    say("say_fresh", "feeling fresh!", { bindings: [hiddenWhen(booze.id, "gt", 30)] }),
    sayTipsy,
    say("say_cab", "call me a cab...", { bindings: [hiddenWhen(booze.id, "le", 70)] }),
    meter,
    blow,
  ]

  // the breath test: a booze-o-meter
  const gauge = createNode("arc", {
    name: "gauge",
    props: {
      min: 0,
      max: 100,
      value: 12,
      bgStart: 135,
      bgEnd: 45,
      rotation: 0,
      mode: "LV_ARC_MODE_NORMAL",
    },
    layout: { x: 0, y: 0, w: 200, h: 200, align: "LV_ALIGN_CENTER" },
    style: {
      "main:default": { arc_width: 12, arc_color: "#262d48" },
      "indicator:default": { arc_width: 12, arc_color: PINK },
      "knob:default": { bg_opa: 0 },
    },
    clickable: false,
    bindings: [{ kind: "value", variable: booze.id }],
    at: at({
      layout: { w: 112, h: 112 },
      style: { "main:default": { arc_width: 7 }, "indicator:default": { arc_width: 7 } },
    }),
  })
  const back = createNode("button", {
    name: "back_button",
    layout: { x: 0, y: -14, w: 40, h: 40, align: "LV_ALIGN_BOTTOM_MID" },
    style: {
      "main:default": { bg_color: "#262d48", radius: 20, shadow_width: 0 },
      "main:pressed": { bg_color: PINK },
    },
    at: at({ layout: { y: -6, w: 26, h: 26 } }),
    children: [
      text(
        "back_icon",
        "",
        "lv_font_montserrat_16",
        CREAM,
        {},
        { at: smallFont("lv_font_montserrat_12") },
      ),
    ],
  })
  const test = createScreen("Test", display, { x: 320, y: 0 })
  test.style = { "main:default": { bg_color: NIGHT } }
  test.children = [
    text(
      "prompt",
      "blow for 3 s",
      "lv_font_montserrat_16",
      CREAM,
      { y: 58, align: "LV_ALIGN_TOP_MID" },
      {
        at: {
          [small.id]: {
            layout: { y: 8 },
            style: { "main:default": { text_font: "lv_font_montserrat_12" } },
          },
        },
      },
    ),
    gauge,
    text(
      "reading",
      "12%",
      "lv_font_montserrat_48",
      "#ffffff",
      { y: -6 },
      {
        bindings: [{ kind: "text", variable: booze.id, format: "%d%%" }],
        at: smallFont("lv_font_montserrat_28"),
      },
    ),
    text(
      "caption",
      "booze-o-meter",
      "lv_font_unscii_8",
      MUTED,
      { y: 30 },
      // the pixel font is too wide for the small ring
      {
        at: at({
          layout: { y: 18 },
          style: { "main:default": { text_font: "lv_font_montserrat_10" } },
        }),
      },
    ),
    back,
  ]

  const go = (screen: string, anim: string) => ({
    id: newId(),
    trigger: "LV_EVENT_CLICKED",
    action: { type: "navigate" as const, screen, anim, duration: 300, delay: 0 },
  })
  blow.events = [go(test.id, "LV_SCREEN_LOAD_ANIM_MOVE_LEFT")]
  back.events = [go(pet.id, "LV_SCREEN_LOAD_ANIM_MOVE_RIGHT")]

  const idle: Animation = {
    ...createAnimation("idle"),
    autoplay: true,
    repeat: -1,
    alternate: true,
    tracks: [
      {
        id: newId(),
        node: buddy.id,
        prop: "translate_y",
        keyframes: keyframes([0, 0, "ease-in-out"], [900, -8, "linear"]),
      },
    ],
  }
  // opacity rather than height, so the blink looks the same at every size
  const blink: Animation = {
    ...createAnimation("blink"),
    autoplay: true,
    repeat: -1,
    tracks: eyes.map(e => ({
      id: newId(),
      node: e.id,
      prop: "opa",
      keyframes: keyframes(
        [0, 255, "linear"],
        [2600, 255, "ease-in"],
        [2660, 0, "ease-out"],
        [2780, 255, "linear"],
      ),
    })),
  }
  const spin: Animation = {
    ...createAnimation("dizzy_spin"),
    autoplay: true,
    repeat: -1,
    tracks: [
      {
        id: newId(),
        node: dizzy.id,
        prop: "rotation",
        keyframes: keyframes([0, 0, "linear"], [1400, 3600, "linear"]),
      },
    ],
  }
  const boop: Animation = {
    ...createAnimation("boop"),
    tracks: [
      {
        id: newId(),
        node: buddy.id,
        prop: "scale",
        keyframes: keyframes([0, 256, "ease-out"], [110, 300, "overshoot"], [420, 256, "linear"]),
      },
    ],
  }
  buddy.events = [
    {
      id: newId(),
      trigger: "LV_EVENT_CLICKED",
      action: { type: "play", animation: boop.id, reverse: false, delay: 0 },
    },
  ]

  return {
    kiln: 1,
    name: "Breathalyzer pet",
    target: { board: "esp32-c3-devkitm-1", display },
    theme: { primary: PINK, secondary: MINT, dark: true },
    screens: [pet, test],
    variables: [booze, alarm],
    styles: [],
    tokens: [],
    animations: [idle, blink, spin, boop],
    assets: [],
    fonts: [],
    sizes: [small],
  }
}
