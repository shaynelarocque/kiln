import { create } from "zustand"

export type Theme = "system" | "dark" | "light"
/** Where Build and Flash show their log: a panel under the canvas, or a window of its own. */
export type OutputPlace = "panel" | "window"

/** App preferences: this person's, not the project's. Kept in localStorage, shared by every window. */
export type Settings = {
  theme: Theme
  output: OutputPlace
  /** a line between display pixels once zoomed in far enough to see them */
  pixelGrid: boolean
  /** baud rate the serial monitor opens at when the project doesn't say */
  baud: number
  /** the screen-size bar, for projects that don't have sizes yet */
  sizes: boolean
  /** Kiln's MCP server, for Claude and other AI assistants on this machine */
  mcp: boolean
}

export const SETTINGS_DEFAULTS: Settings = {
  theme: "system",
  output: "panel",
  pixelGrid: true,
  baud: 115200,
  sizes: false,
  mcp: false,
}

const KEY = "kiln.settings"

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    const pick = <K extends keyof Settings>(k: K, ok: (v: unknown) => boolean): Settings[K] =>
      ok(saved[k]) ? saved[k] : SETTINGS_DEFAULTS[k]
    return {
      theme: pick("theme", v => v === "system" || v === "dark" || v === "light"),
      output: pick("output", v => v === "panel" || v === "window"),
      pixelGrid: pick("pixelGrid", v => typeof v === "boolean"),
      baud: pick("baud", v => Number.isInteger(v) && (v as number) > 0),
      sizes: pick("sizes", v => typeof v === "boolean"),
      mcp: pick("mcp", v => typeof v === "boolean"),
    }
  } catch {
    return SETTINGS_DEFAULTS
  }
}

type SettingsState = Settings & { update: (patch: Partial<Settings>) => void }

export const useSettings = create<SettingsState>()(set => ({
  ...load(),
  update: patch => {
    set(patch)
    const { update: _, ...settings } = useSettings.getState()
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      // blocked storage: the change lasts until the window closes
    }
  },
}))

// another window changed them (Kiln's output window shares this storage)
if (typeof window !== "undefined")
  window.addEventListener("storage", e => e.key === KEY && useSettings.setState(load()))
