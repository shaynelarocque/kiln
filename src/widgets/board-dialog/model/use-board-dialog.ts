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
import { edit, useProjectStore, type DisplayConfig, type Phase } from "@/entities/project"
import { budgetFor, pinClaims } from "@/features/export-firmware"

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
      for (const s of d.screens) {
        s.layout.w = d.target.display.width
        s.layout.h = d.target.display.height
      }
    }, phase)

  return {
    project,
    board,
    boards,
    source,
    results,
    query,
    setQuery,
    mcu,
    display,
    pins: pinMap(mcu),
    problems: checkPins(mcu, pinClaims(project)),
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
      edit(d => void (d.target.display.pins[key] = pin)),
  }
}
