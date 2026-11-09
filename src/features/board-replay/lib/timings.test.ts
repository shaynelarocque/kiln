import { expect, it } from "vitest"
import { parseTrace, type Trace } from "@/entities/device"
import { createSampleProject } from "@/entities/project"
import { formatSteps, parseSteps, stepCommand } from "./steps"
import { describeTimings, timingsOf } from "./timings"

// what runtime/kiln_debug.cpp printed for the thermostat sample, run on the host with a fake
// clock (5 ms a loop), replaying: tap settings_button, set target 24, load Home
const LOG = `@K 1000 anim start 650 0 intro
@K 1000 anim start 1800 0 heating_pulse
@K 1000 ready 1 Home
@K 1000 var target 23
@K 1205 pong
@K 1670 anim done intro
@K 2005 frames 50 3100 9200
@K 2810 anim done heating_pulse
@K 2820 ev press settings_button
@K 2885 ok tap settings_button
@K 2900 ev release settings_button
@K 2900 scr unload Home
@K 2900 ev click settings_button
@K 2905 scr load Settings
@K 3005 frames 50 4100 41000
@K 3205 scr loaded Settings
@K 3205 scr unloaded Home
@K 3605 var target 24
@K 3605 ok set target
@K 5205 err there's no layer nope
Thermostat ready, heating on
@K 9 9 nonsense`

const traces = LOG.split("\n")
  .map(parseTrace)
  .filter(t => t !== null) as Trace[]

it("reads kiln-debug's lines, and leaves the app's own logging alone", () => {
  expect(traces).toHaveLength(20)
  expect(traces[2]).toEqual({ ms: 1000, kind: "ready", protocol: 1, screen: "Home" })
  expect(traces[0]).toEqual({
    ms: 1000,
    kind: "anim",
    what: "start",
    playtime: 650,
    delay: 0,
    name: "intro",
  })
  expect(traces.find(t => t.kind === "err")).toMatchObject({ text: "there's no layer nope" })
  expect(parseTrace("Thermostat ready, heating on")).toBeNull()
})

it("measures transitions and animations against the design", () => {
  const t = timingsOf(createSampleProject(), traces)
  expect(t.timings).toEqual([
    { kind: "animation", name: "intro", designed: 650, measured: 670 },
    { kind: "animation", name: "heating_pulse", designed: 1800, measured: 1810 },
    // the settings button navigates with a 300 ms transition
    { kind: "transition", name: "Settings", designed: 300, measured: 300, latency: 5 },
  ])
  expect(t.frames).toEqual({ frames: 100, averageMs: 3.6, longestMs: 41 })
  const lines = describeTimings(t)
  expect(lines[0]).toBe("▸ intro: 650 ms designed, 670 ms on the board (+20)")
  expect(lines[2]).toBe("→ Settings: 300 ms designed, 300 ms on the board; 5 ms after the tap")
  expect(lines[3]).toMatch(/longest 41 ms \(under 30 fps/)
})

it("writes steps as text and reads them back", () => {
  const text =
    "load Home\ntap settings_button\nwait 500\nhold 700 eco switch\nset target 24\nmark done"
  const steps = parseSteps(text)
  expect(steps).toEqual([
    { load: "Home" },
    { tap: "settings_button" },
    { wait: 500 },
    { hold: "eco switch", ms: 700 },
    { set: "target", value: "24" },
    { mark: "done" },
  ])
  expect(formatSteps(steps)).toBe(text)
  expect(stepCommand(steps[3])).toEqual({
    command: "@K hold 700 eco switch",
    ok: "hold eco switch",
  })
  expect(stepCommand(steps[2])).toBeNull()
  expect(() => parseSteps("tap\n")).toThrow(/Line 1/)
  expect(() => parseSteps("swipe left")).toThrow(/no step "swipe"/)
})
