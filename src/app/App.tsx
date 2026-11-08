import { useEffect } from "react"
import { startDevice } from "@/entities/device"
import { startSession, useWorkspace } from "@/features/project-file"
import { EditorPage } from "@/pages/editor"
import { HomePage } from "@/pages/home"
import { OutputPage } from "@/pages/output"
import { windowLabel } from "@/shared/lib/tauri"
import { TabBar } from "@/widgets/tab-bar"
import { startMenu } from "./menu"
import s from "./app.module.css"

const output = windowLabel() === "output"

export function App() {
  useEffect(() => {
    startDevice()
    if (output) return
    const stopSession = startSession()
    const stopMenu = startMenu()
    return () => {
      stopSession()
      stopMenu?.()
    }
  }, [])
  return output ? <OutputPage /> : <Workspace />
}

/** The editor window: project tabs over the home page or the open project. */
function Workspace() {
  const home = useWorkspace(w => w.home || !w.active)
  return (
    <div className={s.workspace}>
      <TabBar />
      {home ? <HomePage /> : <EditorPage />}
    </div>
  )
}
