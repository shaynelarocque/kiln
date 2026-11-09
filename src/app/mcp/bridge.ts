import { syncMcpServer } from "@/features/mcp"
import { inTauri, invoke } from "@/shared/lib/tauri"
import { callTool, toolList } from "./tools"

type Request = { id: number; kind: "list" | "call"; params: { name?: string; arguments?: object } }

async function answer({ id, kind, params }: Request) {
  try {
    const ok =
      kind === "list"
        ? { tools: toolList() }
        : await callTool(params.name ?? "", { ...params.arguments })
    await invoke("mcp_reply", { id, ok, error: null })
  } catch (e) {
    await invoke("mcp_reply", { id, ok: null, error: String(e) })
  }
}

/** Runs Kiln's MCP server as Settings say, and answers its requests here. Returns the cleanup. */
export function startMcp() {
  if (!inTauri()) return () => {}
  const stopSync = syncMcpServer()
  let stop: (() => void) | undefined
  let gone = false
  import("@tauri-apps/api/event").then(async ({ listen }) => {
    const un = await listen<Request>("mcp", e => void answer(e.payload))
    if (gone) un()
    else stop = un
  })
  return () => {
    gone = true
    stop?.()
    stopSync()
  }
}
