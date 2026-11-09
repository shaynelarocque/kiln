import { create } from "zustand"
import { useSettings } from "@/shared/config"
import { inTauri, invoke } from "@/shared/lib/tauri"

/** Kiln's MCP server as the app last said: its URL while on, or why it couldn't start. */
export const useMcp = create<{ url: string | null; error: string | null }>()(() => ({
  url: null,
  error: null,
}))

/** What to run once to give Claude Code this server. */
export const claudeCommand = (url: string) => `claude mcp add --transport http kiln ${url}`

async function apply(on: boolean) {
  try {
    const url = await invoke<string | null>("mcp_enable", { on })
    useMcp.setState({ url, error: null })
  } catch (e) {
    useMcp.setState({ url: null, error: String(e) })
  }
}

/** Starts or stops the server to match Settings, now and whenever it changes. Returns the cleanup. */
export function syncMcpServer() {
  if (!inTauri()) return () => {}
  void apply(useSettings.getState().mcp)
  return useSettings.subscribe((s, prev) => {
    if (s.mcp !== prev.mcp) void apply(s.mcp)
  })
}
