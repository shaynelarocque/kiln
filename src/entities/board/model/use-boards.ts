import { create } from "zustand"
import { loadBoards } from "../api/pio"
import { BUNDLED_BOARDS, type Board } from "./board"

type BoardsState = { boards: Board[]; source: "platformio" | "bundled"; loaded: boolean }

const store = create<BoardsState>()(() => ({ boards: BUNDLED_BOARDS, source: "bundled", loaded: false }))

let started = false

/** The board catalog; asks PlatformIO once per session, falls back to the bundled snapshot. */
export function useBoards() {
  if (!started) {
    started = true
    loadBoards().then(r => store.setState({ ...r, loaded: true }))
  }
  return store()
}
