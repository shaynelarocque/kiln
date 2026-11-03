import boards from "../config/boards.json"

/** A PlatformIO board definition (the fields `pio boards --json-output` gives). */
export type Board = {
  id: string
  name: string
  mcu: string
  fcpu: number
  ram: number
  rom: number
  vendor: string
  url: string
  platform: string
}

/** Snapshot of PlatformIO's catalog (scripts/boards.mjs); refreshed from `pio boards` when it's installed. */
export const BUNDLED_BOARDS = boards as Board[]

export const findBoard = (list: Board[], id: string) => list.find(b => b.id === id)

export type PinUse = "adc" | "output" | "input"

/** What an MCU's GPIOs can do, and which ones to be careful with. */
export type PinMap = {
  gpios: number[]
  adc: number[]
  /** ADC2 can't be read while Wi-Fi is on */
  adc2: number[]
  inputOnly: number[]
  /** sampled at reset: fine as outputs, but don't hold them low at boot */
  strapping: number[]
  /** wired to flash/PSRAM or USB: off limits */
  reserved: Record<number, string>
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

const PIN_MAPS: Record<string, PinMap> = {
  ESP32C3: {
    gpios: [...range(0, 10), ...range(18, 21)],
    adc: range(0, 4),
    adc2: [5],
    inputOnly: [],
    strapping: [2, 8, 9],
    reserved: {
      11: "VDD_SPI",
      12: "flash",
      13: "flash",
      14: "flash",
      15: "flash",
      16: "flash",
      17: "flash",
      18: "USB D−",
      19: "USB D+",
    },
  },
  ESP32S3: {
    gpios: [...range(0, 21), ...range(33, 48)],
    adc: range(1, 10),
    adc2: range(11, 20),
    inputOnly: [],
    strapping: [0, 3, 45, 46],
    reserved: {
      19: "USB D−",
      20: "USB D+",
      26: "flash",
      27: "flash",
      28: "flash",
      29: "flash",
      30: "flash",
      31: "flash",
      32: "flash",
      35: "PSRAM (octal)",
      36: "PSRAM (octal)",
      37: "PSRAM (octal)",
    },
  },
  ESP32S2: {
    gpios: [...range(0, 21), ...range(26, 46)],
    adc: range(1, 10),
    adc2: range(11, 20),
    inputOnly: [46],
    strapping: [0, 45, 46],
    reserved: { 19: "USB D−", 20: "USB D+", 26: "flash/PSRAM" },
  },
  ESP32C6: {
    gpios: range(0, 23),
    adc: range(0, 6),
    adc2: [],
    inputOnly: [],
    strapping: [4, 5, 8, 9, 15],
    reserved: { 12: "USB D−", 13: "USB D+" },
  },
  ESP32: {
    gpios: [...range(0, 5), ...range(12, 19), ...range(21, 23), ...range(25, 27), ...range(32, 39)],
    adc: range(32, 39),
    adc2: [0, 2, 4, 12, 13, 14, 15, 25, 26, 27],
    inputOnly: range(34, 39),
    strapping: [0, 2, 5, 12, 15],
    reserved: {
      6: "flash",
      7: "flash",
      8: "flash",
      9: "flash",
      10: "flash",
      11: "flash",
      1: "UART0 TX",
      3: "UART0 RX",
    },
  },
  RP2040: {
    gpios: range(0, 29),
    adc: range(26, 29),
    adc2: [],
    inputOnly: [],
    strapping: [],
    reserved: {
      23: "power save (Pico)",
      24: "VBUS sense (Pico)",
      25: "LED (Pico)",
      29: "VSYS/3 (Pico)",
    },
  },
}

export const pinMap = (mcu: string): PinMap =>
  PIN_MAPS[mcu.toUpperCase()] ?? {
    gpios: range(0, 39),
    adc: range(0, 39),
    adc2: [],
    inputOnly: [],
    strapping: [],
    reserved: {},
  }

export type PinClaim = { pin: number; who: string; use: PinUse }
export type PinProblem = { pin: number; level: "error" | "warn"; message: string }

/** Checks every claimed pin against the MCU: clashes, missing ADC, reserved and strapping pins. */
export function checkPins(mcu: string, claims: PinClaim[]): PinProblem[] {
  const map = pinMap(mcu)
  const problems: PinProblem[] = []
  const owners = new Map<number, string[]>()
  for (const c of claims) {
    if (c.pin < 0) continue
    owners.set(c.pin, [...(owners.get(c.pin) ?? []), c.who])
    if (map.reserved[c.pin])
      problems.push({
        pin: c.pin,
        level: "error",
        message: `GPIO${c.pin} is ${map.reserved[c.pin]} on ${mcu}`,
      })
    else if (!map.gpios.includes(c.pin))
      problems.push({ pin: c.pin, level: "error", message: `${mcu} has no GPIO${c.pin}` })
    if (c.use === "adc" && !map.adc.includes(c.pin) && !map.adc2.includes(c.pin))
      problems.push({
        pin: c.pin,
        level: "error",
        message: `${c.who}: GPIO${c.pin} can't read analog on ${mcu} (ADC pins: ${map.adc.join(", ")})`,
      })
    if (c.use === "adc" && map.adc2.includes(c.pin))
      problems.push({
        pin: c.pin,
        level: "warn",
        message: `${c.who}: GPIO${c.pin} is on ADC2, which stops working while Wi-Fi is on`,
      })
    if (c.use === "output" && map.inputOnly.includes(c.pin))
      problems.push({
        pin: c.pin,
        level: "error",
        message: `${c.who}: GPIO${c.pin} is input-only on ${mcu}`,
      })
    if (map.strapping.includes(c.pin))
      problems.push({
        pin: c.pin,
        level: "warn",
        message: `${c.who}: GPIO${c.pin} is a strapping pin; make sure nothing holds it at reset`,
      })
  }
  for (const [pin, who] of owners)
    if (who.length > 1)
      problems.push({
        pin,
        level: "error",
        message: `GPIO${pin} is used twice: ${who.join(" and ")}`,
      })
  return problems
}
