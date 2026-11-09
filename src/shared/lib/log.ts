import { inTauri, invoke } from "./tauri"

/**
 * Writes to Kiln's log file (Help › Show Logs), where a problem on someone else's machine can be
 * read afterwards. In a plain browser the console already has it, so this does nothing.
 */
export function logError(message: string) {
  if (!inTauri()) return
  import("@tauri-apps/plugin-log").then(log => log.error(message)).catch(() => {})
}

/** Shows the log file in Finder, ready to attach to a message. */
export const revealLogs = () => invoke("reveal_logs")
