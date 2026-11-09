import { useMemo, useState } from "react"
import {
  DISPLAY_PRESETS,
  checkPins,
  findBoard,
  pinMap,
  useBoards,
  type DisplayPreset,
} from "@/entities/board"
import { editorApi, nodeBoxes, useEditorStore } from "@/entities/editor"
import {
  edit as editProject,
  newId,
  projectApi,
  useProjectStore,
  type ButtonKey,
  type DisplayConfig,
  type HardwareButton,
  type Phase,
  type Project,
  type TouchConfig,
  type TouchDriver,
} from "@/entities/project"
import { budgetFor, currentFirmware, pinClaims, wiringProblems } from "@/features/export-firmware"
import { rememberHardware } from "@/features/project-file"
import { kitIndex, type Kit } from "./kits"

/** Every change here is also remembered as this person's hardware, for the next new project. */
const edit: typeof editProject = (recipe, phase) => {
  editProject(recipe, phase)
  if (phase !== "move") rememberHardware(projectApi.getState().project.target)
}

/** Screens always fill the panel. */
const fitScreens = (d: Project) => {
  for (const s of d.screens) {
    s.layout.w = d.target.display.width
    s.layout.h = d.target.display.height
  }
}

/** What a new button does: the first moves focus, the second presses, and so on. */
const NEW_BUTTON_KEYS: ButtonKey[] = ["next", "enter", "prev", "esc"]

/** A touch chip's starting point: I2C chips report pixels, the XPT2046 needs a raw range. */
function touchFor(driver: TouchDriver, display: DisplayConfig): TouchConfig {
  const odd = display.rotation % 2 === 1
  // ranges are in the panel's own orientation, before rotation
  const [w, h] = odd ? [display.height, display.width] : [display.width, display.height]
  const none = { sda: -1, scl: -1, int: -1, rst: -1, cs: -1, sck: -1, mosi: -1, miso: -1 }
  const pins = { ...none, ...display.touch?.pins }
  // an XPT2046 starts out on the display's bus
  if (driver === "xpt2046") {
    if (pins.sck < 0) pins.sck = display.pins.sck
    if (pins.mosi < 0) pins.mosi = display.pins.mosi
  }
  return driver === "xpt2046"
    ? { driver, pins, xMin: 300, xMax: 3900, yMin: 400, yMax: 3900, rotation: 0 }
    : { driver, pins, xMin: 0, xMax: w - 1, yMin: 0, yMax: h - 1, rotation: 0 }
}

/** View-model for the board dialog: which board, which panel, which pins, and whether it all fits. */
export function useBoardDialog() {
  const project = useProjectStore(s => s.project)
  const rects = useEditorStore(s => s.rects)
  const { boards, source } = useBoards()
  const [query, setQuery] = useState("")
  const board = findBoard(boards, project.target.board)
  const mcu = board?.mcu ?? "ESP32C3"
  const display = project.target.display

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits = q
      ? boards.filter(b => `${b.name} ${b.id} ${b.mcu} ${b.vendor}`.toLowerCase().includes(q))
      : boards.filter(b => b.mcu === mcu)
    // the chosen board leads the list so it's never scrolled out of sight
    const current = hits.find(b => b.id === project.target.board)
    return (current ? [current, ...hits.filter(b => b !== current)] : hits).slice(0, 80)
  }, [boards, query, mcu, project.target.board])

  /** Display changes also resize every screen, which always fills the panel. */
  const setDisplay = (patch: Partial<DisplayConfig>, phase?: Phase) =>
    edit(d => {
      Object.assign(d.target.display, patch)
      fitScreens(d)
    }, phase)

  const size = useProjectStore(s => s.doc.sizes.find(z => z.id === s.size))
  const claims = pinClaims(project)

  return {
    project,
    /** the size whose hardware this is, when not the base */
    sizeName: size?.name ?? null,
    claims: claims.filter(c => c.pin >= 0).sort((a, b) => a.pin - b.pin),
    /** Kiln's PlatformIO config and the panel config, as the export writes them */
    pioFiles: () =>
      currentFirmware().filter(f => f.path === "kiln.ini" || f.path.endsWith("lgfx_user.hpp")),
    board,
    boards,
    source,
    results,
    query,
    setQuery,
    mcu,
    display,
    pins: pinMap(mcu),
    problems: [...checkPins(mcu, claims), ...wiringProblems(project, mcu)],
    budget: budgetFor(project, board, nodeBoxes(rects)),
    close: () => editorApi.getState().set({ dialog: null }),
    selectBoard: (id: string) => edit(d => void (d.target.board = id)),
    setDisplay,
    applyPreset: (p: DisplayPreset) =>
      setDisplay({
        driver: p.driver,
        width: p.width,
        height: p.height,
        round: Boolean(p.round),
        invert: p.invert,
        bgr: p.bgr,
        offsetX: p.offsetX ?? 0,
        offsetY: p.offsetY ?? 0,
        rotation: 0,
      }),
    presetIndex: DISPLAY_PRESETS.findIndex(
      p =>
        p.driver === display.driver &&
        p.width === display.width &&
        p.height === display.height &&
        (p.offsetX ?? 0) === display.offsetX &&
        (p.offsetY ?? 0) === display.offsetY,
    ),
    setPin: (key: keyof DisplayConfig["pins"], pin: number) =>
      edit(d => {
        const { pins, touch } = d.target.display
        // a touch panel on the display's bus moves with it
        if (touch?.driver === "xpt2046" && (key === "sck" || key === "mosi"))
          if (touch.pins[key] === pins[key]) touch.pins[key] = pin
        pins[key] = pin
      }),

    kitIndex: kitIndex(project.target),
    applyKit: (kit: Kit) =>
      edit(d => {
        d.target.board = kit.target.board
        d.target.display = structuredClone(kit.target.display)
        d.target.buttons = (kit.target.buttons ?? []).map(b => ({ ...b, id: newId() }))
        fitScreens(d)
      }),

    setTouchDriver: (driver: TouchDriver | null) =>
      edit(d => {
        if (driver) d.target.display.touch = touchFor(driver, d.target.display)
        else delete d.target.display.touch
      }),
    setTouch: (patch: Partial<Omit<TouchConfig, "driver" | "pins">>, phase?: Phase) =>
      edit(
        d => void (d.target.display.touch && Object.assign(d.target.display.touch, patch)),
        phase,
      ),
    setTouchPin: (key: keyof TouchConfig["pins"], pin: number) =>
      edit(d => void (d.target.display.touch && (d.target.display.touch.pins[key] = pin))),

    buttons: project.target.buttons ?? [],
    addButton: () =>
      edit(d => {
        const buttons = (d.target.buttons ??= [])
        buttons.push({
          id: newId(),
          name: `Button ${buttons.length + 1}`,
          pin: -1,
          activeLow: true,
          key: NEW_BUTTON_KEYS[buttons.length] ?? "enter",
        })
      }),
    setButton: (id: string, patch: Partial<Omit<HardwareButton, "id">>, phase?: Phase) =>
      edit(d => {
        const b = d.target.buttons?.find(x => x.id === id)
        if (b) Object.assign(b, patch)
      }, phase),
    removeButton: (id: string) =>
      edit(d => void (d.target.buttons = d.target.buttons?.filter(b => b.id !== id))),
  }
}
