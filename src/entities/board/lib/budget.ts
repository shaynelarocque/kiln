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
  imageBytes: number
  widgetTypes: number
}

export type Budget = {
  ram: { used: number; total: number; parts: { label: string; bytes: number }[] }
  flash: { used: number; total: number; parts: { label: string; bytes: number }[] }
  /** what LV_MEM_SIZE should be set to */
  lvglHeap: number
}

const KB = 1024
const ARDUINO_RAM = 48 * KB
const ARDUINO_FLASH = 360 * KB
const LVGL_CORE_FLASH = 380 * KB

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
  // ~200 bytes per object with its styles, observers and timelines, then 50% headroom; never under 48 KB
  const heap = Math.max(48 * KB, Math.ceil(((i.objects * 200 + i.styleProps * 10 + i.stringBytes) * 1.5 + 16 * KB) / KB) * KB)
  const fonts = i.fonts.reduce((sum, f) => sum + fontBytes(f), 0)
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
    lvglHeap: heap,
  }
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)
