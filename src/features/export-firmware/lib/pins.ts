import type { PinClaim } from "@/entities/board"
import type { Project } from "@/entities/project"

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
  for (const v of project.variables) {
    if (v.source?.kind === "analog") claims.push({ pin: v.source.pin, who: v.name, use: "adc" })
    if (v.source?.kind === "digital") claims.push({ pin: v.source.pin, who: v.name, use: "input" })
    if (v.sink) claims.push({ pin: v.sink.pin, who: `${v.name} (out)`, use: "output" })
  }
  return claims
}
