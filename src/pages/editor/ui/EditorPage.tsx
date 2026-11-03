import { useEffect } from "react"
import { editorApi, useEditorStore, type LeftTab } from "@/entities/editor"
import { startAutosave } from "@/features/project-file"
import { Tabs } from "@/shared/ui"
import { Canvas } from "@/widgets/canvas"
import { DataPanel } from "@/widgets/data-panel"
import { Inspector } from "@/widgets/inspector"
import { LayersPanel } from "@/widgets/layers-panel"
import { Player } from "@/widgets/player"
import { Toolbar } from "@/widgets/toolbar"
import { useShortcuts } from "../model/use-shortcuts"
import s from "./editor-page.module.css"

const LEFT_TABS: { value: LeftTab; label: string }[] = [
  { value: "layers", label: "Layers" },
  { value: "data", label: "Data" },
  { value: "styles", label: "Styles" },
  { value: "assets", label: "Assets" },
]

export function EditorPage() {
  useShortcuts()
  useEffect(startAutosave, [])
  const leftTab = useEditorStore(s => s.leftTab)
  const error = useEditorStore(s => s.error)
  const playing = useEditorStore(s => s.playing)
  return (
    <div className={s.page}>
      <Toolbar />
      <aside className={s.left}>
        <Tabs value={leftTab} tabs={LEFT_TABS} onChange={leftTab => editorApi.getState().set({ leftTab })} />
        <div className={s.leftBody}>
          {leftTab === "layers" && <LayersPanel />}
          {leftTab === "data" && <DataPanel />}
        </div>
      </aside>
      <main className={s.center}>
        <Canvas />
        {error && (
          <div className={s.error} role='alert'>
            <strong>Preview error.</strong> {error}
            <button onClick={() => editorApi.getState().set({ error: null })}>Dismiss</button>
          </div>
        )}
      </main>
      <aside className={s.right}>
        <Inspector />
      </aside>
      {playing && <Player />}
    </div>
  )
}
