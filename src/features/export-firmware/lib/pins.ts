import { pinMap, type PinClaim, type PinProblem } from "@/entities/board"
import type { DisplayConfig, Project } from "@/entities/project"

/** The SPI host for the display, and a second one for a touch panel on pins of its own. */
export function spiHosts(mcu: string) {
  if (mcu === "ESP32") return { display: "VSPI_HOST", other: "HSPI_HOST" }
  if (mcu === "ESP32S2" || mcu === "ESP32S3") return { display: "SPI2_HOST", other: "SPI3_HOST" }
  // the C3 and C6 have one SPI host free for peripherals
  if (mcu.startsWith("ESP32")) return { display: "SPI2_HOST", other: null }
  return { display: "0", other: "1" }
}

/** Whether an XPT2046 rides the display's SPI bus (the same clock and data pins). */
export const touchSharesBus = (d: DisplayConfig) =>
  d.touch?.driver === "xpt2046" &&
  d.touch.pins.sck === d.pins.sck &&
  d.touch.pins.mosi === d.pins.mosi

/** Every pin the project uses: the display's, then each variable's source and sink. */
export function pinClaims(project: Project): PinClaim[] {
  const { pins } = project.target.display
  const claims: PinClaim[] = [
    { pin: pins.sck, who: "Display SCK", use: "output" },
    { pin: pins.mosi, who: "Display MOSI", use: "output" },
    { pin: pins.cs, who: "Display CS", use: "output" },
    { pin: pins.dc, who: "Display DC", use: "output" },
    { pin: pins.rst, who: "Display RST", use: "output" },
  ]
  const backlightSink = project.variables.some(v => v.sink?.pin === pins.bl)
  if (!backlightSink) claims.push({ pin: pins.bl, who: "Display backlight", use: "output" })
  const touch = project.target.display.touch
  if (touch?.driver === "xpt2046") {
    // on the display's bus, the clock and data pins are already claimed
    if (!touchSharesBus(project.target.display))
      claims.push(
        { pin: touch.pins.sck, who: "Touch SCK", use: "output" },
        { pin: touch.pins.mosi, who: "Touch MOSI", use: "output" },
      )
    claims.push(
      { pin: touch.pins.miso, who: "Touch MISO", use: "input" },
      { pin: touch.pins.cs, who: "Touch CS", use: "output" },
      { pin: touch.pins.int, who: "Touch IRQ", use: "input" },
    )
  } else if (touch)
    claims.push(
      // I2C lines are driven both ways, so they can't be input-only pins
      { pin: touch.pins.sda, who: "Touch SDA", use: "output" },
      { pin: touch.pins.scl, who: "Touch SCL", use: "output" },
      { pin: touch.pins.int, who: "Touch INT", use: "input" },
      { pin: touch.pins.rst, who: "Touch reset", use: "output" },
    )
  for (const b of project.target.buttons ?? [])
    claims.push({ pin: b.pin, who: `Button “${b.name}”`, use: "input" })
  for (const v of project.variables) {
    if (v.source?.kind === "analog") claims.push({ pin: v.source.pin, who: v.name, use: "adc" })
    if (v.source?.kind === "digital") claims.push({ pin: v.source.pin, who: v.name, use: "input" })
    if (v.sink) claims.push({ pin: v.sink.pin, who: `${v.name} (out)`, use: "output" })
  }
  return claims
}

/** Wiring that's missing or can't work, beyond pins clashing (see checkPins). */
export function wiringProblems(project: Project, mcu: string): PinProblem[] {
  const problems: PinProblem[] = []
  const error = (message: string) => problems.push({ pin: -1, level: "error", message })
  const { display } = project.target
  const touch = display.touch
  if (touch?.driver === "xpt2046") {
    if (touch.pins.cs < 0 || touch.pins.miso < 0) error("Pick the touch panel's CS and MISO pins.")
    if (!touchSharesBus(display) && !spiHosts(mcu).other)
      error(
        `The ${mcu} has one SPI bus for the display and the touch panel: give the touch panel the display's SCK and MOSI.`,
      )
  } else if (touch && (touch.pins.sda < 0 || touch.pins.scl < 0))
    error("Pick the touch panel's SDA and SCL pins.")
  const inputOnly = pinMap(mcu).inputOnly
  for (const b of project.target.buttons ?? []) {
    if (b.pin < 0) error(`Pick a pin for the button “${b.name}”.`)
    else if (inputOnly.includes(b.pin))
      problems.push({
        pin: b.pin,
        level: "warn",
        message: `Button “${b.name}”: GPIO${b.pin} has no internal pull resistor, so it needs one on the board.`,
      })
  }
  return problems
}
