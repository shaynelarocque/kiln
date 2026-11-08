import { useEffect } from "react"
import { startDevice } from "@/entities/device"
import { EditorPage } from "@/pages/editor"
import { OutputPage } from "@/pages/output"
import { windowLabel } from "@/shared/lib/tauri"
import { startMenu } from "./menu"

const output = windowLabel() === "output"

export function App() {
  useEffect(() => {
    startDevice()
    if (!output) return startMenu()
  }, [])
  return output ? <OutputPage /> : <EditorPage />
}
