import { WIDGETS, type WidgetType } from "@/shared/lvgl"
import type { Animation, DisplayConfig, Node, Project, Screen, Variable } from "./types"

export const newId = () => crypto.randomUUID().slice(0, 8)

export function createNode(widget: WidgetType, overrides: Partial<Node> = {}): Node {
  const def = WIDGETS[widget]
  const node: Node = {
    id: newId(),
    name: def.label,
    widget,
    props: Object.fromEntries(def.props.map(p => [p.key, p.default])),
    layout: { x: 0, y: 0, w: def.size[0], h: def.size[1], align: "LV_ALIGN_TOP_LEFT" },
    style: {},
    classes: [],
    bindings: [],
    events: [],
    children: [],
    ...overrides,
  }
  if (widget === "button" && !overrides.children)
    node.children = [
      createNode("label", {
        name: "Label",
        props: { ...node.props, text: "Button", longMode: "LV_LABEL_LONG_MODE_WRAP" },
        layout: { x: 0, y: 0, w: "content", h: "content", align: "LV_ALIGN_CENTER" },
      }),
    ]
  return node
}

export function createScreen(name: string, display: DisplayConfig, frame = { x: 0, y: 0 }): Screen {
  return {
    ...createNode("screen", { name }),
    widget: "screen",
    layout: { x: 0, y: 0, w: display.width, h: display.height, align: "LV_ALIGN_TOP_LEFT" },
    frame,
  }
}

export function createVariable(name: string, overrides: Partial<Variable> = {}): Variable {
  return {
    id: newId(),
    name,
    type: "int",
    initial: 0,
    min: 0,
    max: 100,
    sim: { kind: "none", period: 4000 },
    source: null,
    sink: null,
    ...overrides,
  }
}

export function createAnimation(name: string): Animation {
  return { id: newId(), name, tracks: [], repeat: 0, alternate: false, delay: 0, autoplay: false }
}

export const DEFAULT_DISPLAY: DisplayConfig = {
  driver: "gc9a01",
  width: 240,
  height: 240,
  round: true,
  invert: true,
  bgr: false,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  spiMHz: 40,
  pins: { sck: 6, mosi: 7, cs: 10, dc: 5, rst: 4, bl: 3 },
  bufferRows: 24,
}

export function createEmptyProject(name = "Untitled"): Project {
  return {
    kiln: 1,
    name,
    target: { board: "esp32-c3-devkitm-1", display: DEFAULT_DISPLAY },
    theme: { primary: "#ff6a00", secondary: "#2196f3", dark: true },
    screens: [createScreen("Home", DEFAULT_DISPLAY)],
    variables: [],
    styles: [],
    tokens: [],
    animations: [],
    assets: [],
    fonts: [],
    sizes: [],
  }
}

const label = (
  name: string,
  text: string,
  font: string,
  color: string,
  extra: Partial<Node> = {},
) =>
  createNode("label", {
    name,
    props: { text, longMode: "LV_LABEL_LONG_MODE_WRAP" },
    layout: { x: 0, y: 0, w: "content", h: "content", align: "LV_ALIGN_CENTER" },
    style: { "main:default": { text_font: font, text_color: color } },
    ...extra,
  })

/** The project a first launch opens: a round thermostat for an ESP32-C3. */
export function createSampleProject(): Project {
  const display = DEFAULT_DISPLAY
  const temperature = createVariable("temperature", {
    initial: 21,
    min: 10,
    max: 35,
    sim: { kind: "sine", period: 9000 },
    source: { kind: "analog", pin: 0, inMin: 0, inMax: 4095, every: 500 },
  })
  const target = createVariable("target", { initial: 23, min: 10, max: 30 })
  const heating = createVariable("heating", {
    initial: 1,
    min: 0,
    max: 1,
    sim: { kind: "square", period: 3000 },
    source: {
      kind: "custom",
      expr: "lv_subject_get_int(ui_var_temperature) < lv_subject_get_int(ui_var_target)",
      every: 1000,
    },
    sink: { kind: "digital", pin: 1, invert: false },
  })
  const eco = createVariable("eco", { initial: 0, min: 0, max: 1 })
  const brightness = createVariable("brightness", {
    initial: 80,
    min: 5,
    max: 100,
    sink: { kind: "pwm", pin: display.pins.bl },
  })

  const accent = { id: newId(), name: "accent", value: "#ff6a00" }
  const muted = { id: newId(), name: "muted", value: "#7b8794" }
  const card = {
    id: newId(),
    name: "card",
    props: {
      bg_color: "#1b222c",
      bg_opa: 255,
      radius: 14,
      border_width: 0,
      pad_top: 10,
      pad_bottom: 10,
      pad_left: 14,
      pad_right: 14,
    },
  }

  const dial = createNode("arc", {
    name: "dial",
    props: {
      min: 10,
      max: 30,
      value: 23,
      bgStart: 135,
      bgEnd: 45,
      rotation: 0,
      mode: "LV_ARC_MODE_NORMAL",
    },
    layout: { x: 0, y: 0, w: 210, h: 210, align: "LV_ALIGN_CENTER" },
    style: {
      "main:default": { arc_width: 14, arc_color: "#1f2933" },
      "indicator:default": { arc_width: 14, arc_color: `$${accent.id}` },
      "knob:default": { bg_color: "#ffffff", pad_top: 2, pad_bottom: 2, pad_left: 2, pad_right: 2 },
      "knob:pressed": { transform_scale_x: 320, transform_scale_y: 320 },
    },
    transition: {
      props: ["transform_scale_x", "transform_scale_y"],
      duration: 160,
      delay: 0,
      easing: "ease-out",
    },
    bindings: [{ kind: "value", variable: target.id }],
  })
  const temp = label("temperature", "21°", "lv_font_montserrat_48", "#ffffff", {
    layout: { x: 0, y: -8, w: "content", h: "content", align: "LV_ALIGN_CENTER" },
    bindings: [{ kind: "text", variable: temperature.id, format: "%d°" }],
  })
  const targetLabel = label("target_label", "Target 23°", "lv_font_montserrat_16", `$${muted.id}`, {
    layout: { x: 0, y: 34, w: "content", h: "content", align: "LV_ALIGN_CENTER" },
    bindings: [{ kind: "text", variable: target.id, format: "Target %d°" }],
  })
  const flame = label("heating_icon", "\uf0e7 Heating", "lv_font_montserrat_14", `$${accent.id}`, {
    layout: { x: 0, y: -52, w: "content", h: "content", align: "LV_ALIGN_CENTER" },
    bindings: [
      { kind: "flag", variable: heating.id, flag: "LV_OBJ_FLAG_HIDDEN", compare: "eq", ref: 0 },
    ],
  })
  const settingsButton = createNode("button", {
    name: "settings_button",
    layout: { x: 0, y: -18, w: 44, h: 44, align: "LV_ALIGN_BOTTOM_MID" },
    style: {
      "main:default": { radius: 22, bg_color: "#1f2933", shadow_width: 0 },
      "main:pressed": { bg_color: `$${accent.id}` },
    },
    transition: { props: ["bg_color"], duration: 150, delay: 0, easing: "ease-out" },
  })
  settingsButton.children = [label("settings_icon", "", "lv_font_montserrat_20", "#ffffff")]

  const home = createScreen("Home", display, { x: 0, y: 0 })
  home.style = { "main:default": { bg_color: "#0b0f14" } }
  home.children = [dial, flame, temp, targetLabel, settingsButton]

  const settings = createScreen("Settings", display, { x: 320, y: 0 })
  settings.style = { "main:default": { bg_color: "#0b0f14" } }
  const row = (name: string, text: string, control: Node) => {
    const r = createNode("container", {
      name,
      layout: {
        x: 0,
        y: 0,
        w: 168,
        h: "content",
        align: "LV_ALIGN_TOP_LEFT",
        flex: {
          flow: "LV_FLEX_FLOW_ROW",
          main: "LV_FLEX_ALIGN_SPACE_BETWEEN",
          cross: "LV_FLEX_ALIGN_CENTER",
          track: "LV_FLEX_ALIGN_CENTER",
        },
      },
      classes: [{ style: card.id, selector: "main:default" }],
    })
    r.children = [
      label(`${name}_label`, text, "lv_font_montserrat_14", "#e4e7eb", {
        layout: { x: 0, y: 0, w: "content", h: "content", align: "LV_ALIGN_TOP_LEFT" },
      }),
      control,
    ]
    return r
  }
  const ecoSwitch = createNode("switch", {
    name: "eco_switch",
    bindings: [{ kind: "checked", variable: eco.id }],
    layout: { x: 0, y: 0, w: 44, h: 24, align: "LV_ALIGN_TOP_LEFT" },
  })
  const dim = createNode("slider", {
    name: "brightness_slider",
    props: { min: 5, max: 100, value: 80 },
    layout: { x: 0, y: 0, w: 150, h: 8, align: "LV_ALIGN_TOP_LEFT" },
    bindings: [{ kind: "value", variable: brightness.id }],
  })
  const list = createNode("container", {
    name: "settings_list",
    layout: {
      x: 0,
      y: 6,
      w: "content",
      h: "content",
      align: "LV_ALIGN_CENTER",
      flex: {
        flow: "LV_FLEX_FLOW_COLUMN",
        main: "LV_FLEX_ALIGN_START",
        cross: "LV_FLEX_ALIGN_CENTER",
        track: "LV_FLEX_ALIGN_CENTER",
      },
    },
    style: {
      "main:default": {
        bg_opa: 0,
        border_width: 0,
        pad_row: 10,
        pad_top: 0,
        pad_bottom: 0,
        pad_left: 0,
        pad_right: 0,
      },
    },
  })
  const brightnessCard = createNode("container", {
    name: "brightness_row",
    layout: {
      x: 0,
      y: 0,
      w: 168,
      h: "content",
      align: "LV_ALIGN_TOP_LEFT",
      flex: {
        flow: "LV_FLEX_FLOW_COLUMN",
        main: "LV_FLEX_ALIGN_START",
        cross: "LV_FLEX_ALIGN_CENTER",
        track: "LV_FLEX_ALIGN_CENTER",
      },
    },
    classes: [{ style: card.id, selector: "main:default" }],
    style: { "main:default": { pad_row: 10 } },
  })
  brightnessCard.children = [
    label("brightness_label", "Brightness", "lv_font_montserrat_14", "#e4e7eb", {
      layout: { x: 0, y: 0, w: "content", h: "content", align: "LV_ALIGN_TOP_LEFT" },
    }),
    dim,
  ]
  list.children = [row("eco_row", "Eco mode", ecoSwitch), brightnessCard]
  const back = createNode("button", {
    name: "back_button",
    layout: { x: 0, y: -16, w: 44, h: 44, align: "LV_ALIGN_BOTTOM_MID" },
    style: { "main:default": { radius: 22, bg_color: "#1f2933", shadow_width: 0 } },
  })
  back.children = [label("back_icon", "", "lv_font_montserrat_18", "#ffffff")]
  const title = label("title", "Settings", "lv_font_montserrat_18", "#ffffff", {
    layout: { x: 0, y: 30, w: "content", h: "content", align: "LV_ALIGN_TOP_MID" },
  })
  settings.children = [title, list, back]

  settingsButton.events = [
    {
      id: newId(),
      trigger: "LV_EVENT_CLICKED",
      action: {
        type: "navigate",
        screen: settings.id,
        anim: "LV_SCREEN_LOAD_ANIM_MOVE_LEFT",
        duration: 300,
        delay: 0,
      },
    },
  ]
  back.events = [
    {
      id: newId(),
      trigger: "LV_EVENT_CLICKED",
      action: {
        type: "navigate",
        screen: home.id,
        anim: "LV_SCREEN_LOAD_ANIM_MOVE_RIGHT",
        duration: 300,
        delay: 0,
      },
    },
  ]

  const intro: Animation = {
    ...createAnimation("intro"),
    autoplay: true,
    tracks: [
      {
        id: newId(),
        node: dial.id,
        prop: "scale",
        keyframes: [
          { t: 0, value: 180, easing: "ease-out" },
          { t: 600, value: 256, easing: "linear" },
        ],
      },
      {
        id: newId(),
        node: dial.id,
        prop: "opa",
        keyframes: [
          { t: 0, value: 0, easing: "ease-out" },
          { t: 450, value: 255, easing: "linear" },
        ],
      },
      {
        id: newId(),
        node: temp.id,
        prop: "translate_y",
        keyframes: [
          { t: 150, value: 16, easing: "overshoot" },
          { t: 650, value: 0, easing: "linear" },
        ],
      },
    ],
  }
  const pulse: Animation = {
    ...createAnimation("heating_pulse"),
    autoplay: true,
    repeat: -1,
    alternate: true,
    tracks: [
      {
        id: newId(),
        node: flame.id,
        prop: "opa",
        keyframes: [
          { t: 0, value: 255, easing: "ease-in-out" },
          { t: 900, value: 90, easing: "linear" },
        ],
      },
    ],
  }

  return {
    kiln: 1,
    name: "Thermostat",
    target: { board: "esp32-c3-devkitm-1", display },
    theme: { primary: "#ff6a00", secondary: "#2196f3", dark: true },
    screens: [home, settings],
    variables: [temperature, target, heating, eco, brightness],
    styles: [card],
    tokens: [accent, muted],
    animations: [intro, pulse],
    assets: [],
    fonts: [],
    sizes: [],
  }
}
