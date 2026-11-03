import { inTauri, invoke } from "@/shared/lib/tauri"
import { BUNDLED_BOARDS, type Board } from "../model/board"

type PioBoard = Board & { frameworks: string[] }

/** Boards from the local PlatformIO install when there is one, else the bundled snapshot. */
export async function loadBoards(): Promise<{ boards: Board[]; source: "platformio" | "bundled" }> {
  if (!inTauri()) return { boards: BUNDLED_BOARDS, source: "bundled" }
  try {
    const raw = await invoke<string>("pio_boards")
    const boards = (JSON.parse(raw) as PioBoard[])
      .filter(b => b.frameworks.includes("arduino") && b.ram >= 64 * 1024)
      .map(({ id, name, mcu, fcpu, ram, rom, vendor, url, platform }) => ({
        id,
        name,
        mcu,
        fcpu,
        ram,
        rom,
        vendor,
        url,
        platform,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { boards, source: "platformio" }
  } catch {
    return { boards: BUNDLED_BOARDS, source: "bundled" }
  }
}
