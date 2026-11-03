import type { DisplayConfig, HardwareButton, Target, TouchConfig } from "@/entities/project"

/** A dev board with the screen built on: board, panel, wiring, touch and buttons, all set. */
export type Kit = { label: string; target: Target }

const touchPins = (pins: Partial<TouchConfig["pins"]>): TouchConfig["pins"] => ({
  sda: -1,
  scl: -1,
  int: -1,
  rst: -1,
  cs: -1,
  sck: -1,
  mosi: -1,
  miso: -1,
  ...pins,
})

const panel = (d: Omit<DisplayConfig, "rotation" | "bufferRows">): DisplayConfig => ({
  rotation: 0,
  bufferRows: 24,
  ...d,
})

const button = (name: string, pin: number, key: HardwareButton["key"]): HardwareButton => ({
  id: name.toLowerCase(),
  name,
  pin,
  activeLow: true,
  key,
})

export const KITS: Kit[] = [
  {
    label: "ESP32-2424S012 · C3, 1.28″ round, touch",
    target: {
      board: "esp32-c3-devkitm-1",
      display: panel({
        driver: "gc9a01",
        width: 240,
        height: 240,
        round: true,
        invert: true,
        bgr: false,
        offsetX: 0,
        offsetY: 0,
        spiMHz: 40,
        pins: { sck: 6, mosi: 7, cs: 10, dc: 2, rst: -1, bl: 3 },
        touch: {
          driver: "cst816s",
          pins: touchPins({ sda: 4, scl: 5, int: 0, rst: 1 }),
          xMin: 0,
          xMax: 239,
          yMin: 0,
          yMax: 239,
          rotation: 0,
        },
      }),
      buttons: [],
    },
  },
  {
    label: "Waveshare ESP32-S3-Touch-LCD-1.28 · round, touch",
    target: {
      board: "esp32-s3-devkitc-1",
      display: panel({
        driver: "gc9a01",
        width: 240,
        height: 240,
        round: true,
        invert: true,
        bgr: false,
        offsetX: 0,
        offsetY: 0,
        spiMHz: 40,
        pins: { sck: 10, mosi: 11, cs: 9, dc: 8, rst: 14, bl: 2 },
        touch: {
          driver: "cst816s",
          pins: touchPins({ sda: 6, scl: 7, int: 5, rst: 13 }),
          xMin: 0,
          xMax: 239,
          yMin: 0,
          yMax: 239,
          rotation: 0,
        },
      }),
      buttons: [],
    },
  },
  {
    label: "ESP32-2432S028R “Cheap Yellow Display” · 2.8″, resistive touch",
    target: {
      board: "esp32dev",
      display: panel({
        driver: "ili9341",
        width: 240,
        height: 320,
        round: false,
        invert: false,
        bgr: false,
        offsetX: 0,
        offsetY: 0,
        spiMHz: 40,
        pins: { sck: 14, mosi: 13, cs: 15, dc: 2, rst: -1, bl: 21 },
        // the touch panel has an SPI bus of its own
        touch: {
          driver: "xpt2046",
          pins: touchPins({ sck: 25, mosi: 32, miso: 39, cs: 33, int: 36 }),
          xMin: 300,
          xMax: 3900,
          yMin: 400,
          yMax: 3900,
          rotation: 0,
        },
      }),
      buttons: [],
    },
  },
  {
    label: "LilyGO T-Display · 1.14″, two buttons",
    target: {
      board: "lilygo-t-display",
      display: panel({
        driver: "st7789",
        width: 135,
        height: 240,
        round: false,
        invert: true,
        bgr: false,
        offsetX: 52,
        offsetY: 40,
        spiMHz: 40,
        pins: { sck: 18, mosi: 19, cs: 5, dc: 16, rst: 23, bl: 4 },
      }),
      buttons: [button("Top", 0, "next"), button("Bottom", 35, "enter")],
    },
  },
]

/** The kit a target was set up from, if it still matches one. */
export const kitIndex = (target: Target) =>
  KITS.findIndex(
    k =>
      k.target.board === target.board &&
      k.target.display.driver === target.display.driver &&
      JSON.stringify(k.target.display.pins) === JSON.stringify(target.display.pins) &&
      k.target.display.touch?.driver === target.display.touch?.driver,
  )
