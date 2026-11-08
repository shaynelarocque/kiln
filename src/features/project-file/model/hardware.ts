import type { DisplayConfig, Project, Target } from "@/entities/project"

const KEY = "kiln:hardware"

/**
 * The board and panel last set up in the board dialog. New projects and samples start on it, so
 * wiring, SPI clock and colour fixes tuned for a real panel aren't re-entered for every project.
 */
export function rememberHardware(target: Target) {
  try {
    localStorage.setItem(KEY, JSON.stringify(target))
  } catch {
    // blocked storage: new projects just start on their own defaults
  }
}

export function savedHardware(): Target | null {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? "null")
    return typeof t?.board === "string" && /^[\w.-]+$/.test(t.board) && t.display?.pins ? t : null
  } catch {
    return null
  }
}

const samePanel = (a: DisplayConfig, b: DisplayConfig) =>
  a.driver === b.driver && a.width === b.width && a.height === b.height && a.round === b.round

/**
 * A target moved onto the saved hardware. The same panel takes everything; a project designed
 * for another panel keeps its panel and takes the board, the wiring and the SPI clock.
 */
function onto(target: Target, hw: Target): Target {
  if (samePanel(target.display, hw.display)) return structuredClone(hw)
  const { pins, spiMHz } = hw.display
  return {
    ...target,
    board: hw.board,
    buttons: structuredClone(hw.buttons ?? []),
    display: { ...target.display, pins: { ...pins }, spiMHz },
  }
}

/**
 * A new project on the saved hardware. A blank project takes the saved panel too, so its screens
 * are resized to it; samples keep their own size and only take what fits.
 */
export function withHardware(project: Project, blank: boolean, hw = savedHardware()): Project {
  if (!hw) return project
  if (blank) {
    const target = structuredClone(hw)
    const { width, height } = target.display
    return {
      ...project,
      target,
      screens: project.screens.map(s => ({ ...s, layout: { ...s.layout, w: width, h: height } })),
    }
  }
  return {
    ...project,
    target: onto(project.target, hw),
    sizes: project.sizes.map(s => ({ ...s, target: onto(s.target, hw) })),
  }
}
