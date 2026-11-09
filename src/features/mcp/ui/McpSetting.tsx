import { Copy } from "lucide-react"
import { useState } from "react"
import { useSettings } from "@/shared/config"
import { inTauri } from "@/shared/lib/tauri"
import { IconButton, Toggle } from "@/shared/ui"
import { claudeCommand, useMcp } from "../model/server"
import s from "./mcp-setting.module.css"

/** The switch for Kiln's MCP server. */
export function McpToggle() {
  const on = useSettings(st => st.mcp)
  return (
    <Toggle
      label='AI assistants (MCP)'
      checked={on && inTauri()}
      onChange={mcp => inTauri() && useSettings.getState().update({ mcp })}
    />
  )
}

/** While the server is on: how to connect Claude to it, or why it couldn't start. */
export function McpConnect() {
  const on = useSettings(st => st.mcp)
  const { url, error } = useMcp()
  const [copied, setCopied] = useState(false)
  if (!on || !inTauri()) return null
  if (error) return <p className={s.error}>{error}</p>
  if (!url) return null
  const command = claudeCommand(url)
  return (
    <div className={s.connect}>
      <span>Connect Claude Code once with:</span>
      <div className={s.command}>
        <code>{command}</code>
        <IconButton
          label={copied ? "Copied" : "Copy"}
          onClick={() =>
            navigator.clipboard.writeText(command).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }
        >
          <Copy />
        </IconButton>
      </div>
      <span>Other MCP clients connect to {url} (Streamable HTTP).</span>
    </div>
  )
}
