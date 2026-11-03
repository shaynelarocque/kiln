import { TTF_GLYPH_CACHE } from "@/shared/lvgl"

/**
 * Rough RAM/flash estimate for an exported UI, calibrated against a real build (the sample
 * thermostat on an ESP32-C3, Arduino core 3, LVGL 9.6: 958 KB flash, 73 KB static RAM).
 * It's for spotting "this won't fit", not exact numbers.
 */
export type BudgetInput = {
  ram: number
  rom: number
  width: number
  height: number
  bufferRows: number
  objects: number
  styleProps: number
  stringBytes: number
  fonts: string[]
  /** bytes of the imported TTF/OTF files the UI uses */
  ttfBytes: number
  /** pixel size of each TinyTTF font the UI makes */
  ttfSizes: number[]
  imageBytes: number
  widgetTypes: number
  /** the biggest transform layer LVGL will allocate (see transformLayerBytes) */
  layerBytes: number
}

export type Budget = {
  ram: { used: number; total: number; parts: { label: string; bytes: number }[] }
  flash: { used: number; total: number; parts: { label: string; bytes: number }[] }
  /** what LV_MEM_SIZE should be set to: what the UI needs, or as much as the board can hold */
  lvglHeap: number
  /** the UI needs more heap than the board can hold (lvglHeap is the most it can) */
  heapShort: boolean
}

const KB = 1024
const ARDUINO_RAM = 48 * KB
/**
 * The share of a board's RAM that static data can take: an ESP32-C3's link region held about
 * 284 KB of PlatformIO's 320 KB. LVGL's own statics are allowed for too.
 */
const STATIC_SHARE = 0.85
const LVGL_STATICS = 16 * KB
const ARDUINO_FLASH = 360 * KB
const LVGL_CORE_FLASH = 380 * KB
/** TinyTTF and the stb_truetype rasteriser inside it: 26 KB on a real ESP32-C3 build */
const TINY_TTF_FLASH = 26 * KB

/**
 * The ARGB8888 layer LVGL draws a rotated or scaled widget into, from its heap, for each draw.
 * Rotated, the worst case is the whole widget and its shadow; scaled only, it's the widget's
 * width times the rows that map back onto one refresh band of `bufferRows`. LVGL pads it by
 * 5 px a side.
 */
export function transformLayerBytes(
  w: number,
  h: number,
  t: { rotates: boolean; minScale: number; shadow: number },
  bufferRows: number,
) {
  const width = w + 2 * t.shadow + 10
  const height = h + 2 * t.shadow + 10
  const rows = t.rotates
    ? height
    : Math.min(height, Math.ceil((bufferRows * 256) / Math.max(1, t.minScale)) + 10)
  return width * rows * 4
}

/** A TinyTTF font's glyph cache when full: A8 bitmaps of about 0.45 px² each, plus cache bookkeeping. */
export const ttfCacheBytes = (size: number) =>
  TTF_GLYPH_CACHE * Math.round(0.45 * size * size + 200)

/** Montserrat at 4 bpp is roughly 45 bytes per pixel of size squared (ASCII plus symbols). */
export const fontBytes = (font: string) => {
  const size = Number(/(\d+)$/.exec(font)?.[1] ?? 14)
  return font.includes("unscii") ? size * 256 : Math.round(45 * size * size)
}

/** ESP32 Arduino builds use the default partition table: 1.25 MB for the app on a 4 MB chip. */
export function appPartition(platform: string, rom: number) {
  if (platform !== "espressif32") return rom
  return rom <= 4 * 1024 * KB ? 1310720 : Math.round(rom * 0.4)
}

export function estimateBudget(i: BudgetInput): Budget {
  const drawBuffers = 2 * i.width * i.bufferRows * 2
  // ~200 bytes per object with its styles, observers and timelines, plus TinyTTF's glyph caches,
  // then 50% headroom, then room for the biggest transform layer; never under 48 KB
  const caches = i.ttfSizes.reduce((sum, s) => sum + ttfCacheBytes(s), 0)
  const heap = Math.max(
    48 * KB,
    Math.ceil(
      ((i.objects * 200 + i.styleProps * 10 + i.stringBytes + caches) * 1.5 +
        16 * KB +
        i.layerBytes) /
        KB,
    ) * KB,
  )
  const fonts =
    i.fonts.reduce((sum, f) => sum + fontBytes(f), 0) +
    i.ttfBytes +
    (i.ttfSizes.length ? TINY_TTF_FLASH : 0)
  // LV_MEM_SIZE is a static array: bigger than the board holds and the build won't link, so it's
  // capped, and the meter still shows what the UI wanted
  const room =
    Math.floor((i.ram * STATIC_SHARE - drawBuffers - ARDUINO_RAM - LVGL_STATICS) / KB) * KB
  const lvglHeap = Math.max(32 * KB, Math.min(heap, room))
  const ram = [
    { label: "Draw buffers", bytes: drawBuffers },
    { label: "LVGL heap", bytes: heap },
    { label: "Arduino core", bytes: ARDUINO_RAM },
  ]
  const flash = [
    { label: "Arduino core", bytes: ARDUINO_FLASH },
    { label: "LVGL", bytes: LVGL_CORE_FLASH + i.widgetTypes * 6 * KB },
    { label: "Fonts", bytes: fonts },
    { label: "Images", bytes: i.imageBytes },
    { label: "Your UI", bytes: i.objects * 160 + i.styleProps * 24 + i.stringBytes },
  ]
  const sum = (parts: { bytes: number }[]) => parts.reduce((s, p) => s + p.bytes, 0)
  return {
    ram: { used: sum(ram), total: i.ram, parts: ram },
    flash: { used: sum(flash), total: i.rom, parts: flash },
    lvglHeap,
    heapShort: heap > lvglHeap,
  }
}

export const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
