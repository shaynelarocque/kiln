/** SPI panels the firmware export can drive (through LovyanGFX). */
export const DISPLAY_DRIVERS = [
  { value: "gc9a01", label: "GC9A01", panel: "Panel_GC9A01" },
  { value: "st7789", label: "ST7789", panel: "Panel_ST7789" },
  { value: "ili9341", label: "ILI9341", panel: "Panel_ILI9341" },
  { value: "st7735", label: "ST7735", panel: "Panel_ST7735S" },
  { value: "st7796", label: "ST7796", panel: "Panel_ST7796" },
] as const

/** Touch chips the firmware export can read (through LovyanGFX). */
export const TOUCH_DRIVERS = [
  { value: "cst816s", label: "CST816S · capacitive, I2C", touch: "Touch_CST816S", addr: 0x15 },
  { value: "ft6x36", label: "FT6x36 · capacitive, I2C", touch: "Touch_FT5x06", addr: 0x38 },
  // the GT911 answers at 0x14 or 0x5D, depending on its pins at reset; LovyanGFX tries both
  { value: "gt911", label: "GT911 · capacitive, I2C", touch: "Touch_GT911", addr: 0x14 },
  { value: "xpt2046", label: "XPT2046 · resistive, SPI", touch: "Touch_XPT2046", addr: 0 },
] as const

/** LovyanGFX's touch offset_rotation: how the touch layer sits on the panel (4-7 mirror it). */
export const TOUCH_TURNS = [
  "Same as the panel",
  "Turned 90°",
  "Turned 180°",
  "Turned 270°",
  "Mirrored",
  "Mirrored, turned 90°",
  "Mirrored, turned 180°",
  "Mirrored, turned 270°",
]

export type DisplayPreset = {
  label: string
  driver: (typeof DISPLAY_DRIVERS)[number]["value"]
  width: number
  height: number
  round?: boolean
  invert: boolean
  /** swap red and blue */
  bgr: boolean
  /** where the visible area starts in the controller's memory */
  offsetX?: number
  offsetY?: number
}

/** Common modules, with the panel quirks (offsets, inversion, colour order) already set. */
export const DISPLAY_PRESETS: DisplayPreset[] = [
  {
    label: "1.28″ round GC9A01, 240×240",
    driver: "gc9a01",
    width: 240,
    height: 240,
    round: true,
    invert: true,
    bgr: false,
  },
  {
    label: "1.3″/1.54″ ST7789, 240×240",
    driver: "st7789",
    width: 240,
    height: 240,
    invert: true,
    bgr: false,
  },
  {
    label: "1.69″ ST7789, 240×280",
    driver: "st7789",
    width: 240,
    height: 280,
    invert: true,
    bgr: false,
    offsetY: 20,
  },
  {
    label: "1.9″ ST7789, 170×320",
    driver: "st7789",
    width: 170,
    height: 320,
    invert: true,
    bgr: false,
    offsetX: 35,
  },
  {
    label: "1.14″ ST7789, 135×240",
    driver: "st7789",
    width: 135,
    height: 240,
    invert: true,
    bgr: false,
    offsetX: 52,
    offsetY: 40,
  },
  {
    label: "2.0″ ST7789, 240×320",
    driver: "st7789",
    width: 240,
    height: 320,
    invert: true,
    bgr: false,
  },
  {
    label: "2.4″/2.8″ ILI9341, 240×320",
    driver: "ili9341",
    width: 240,
    height: 320,
    invert: false,
    bgr: false,
  },
  {
    label: "1.8″ ST7735, 128×160",
    driver: "st7735",
    width: 128,
    height: 160,
    invert: false,
    bgr: false,
  },
  {
    label: "0.96″ ST7735, 80×160",
    driver: "st7735",
    width: 80,
    height: 160,
    invert: true,
    bgr: false,
    offsetX: 26,
    offsetY: 1,
  },
  {
    label: "3.5″ ST7796, 320×480",
    driver: "st7796",
    width: 320,
    height: 480,
    invert: false,
    bgr: false,
  },
]
