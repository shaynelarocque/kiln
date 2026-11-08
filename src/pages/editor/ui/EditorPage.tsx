import {
  editorApi,
  PANEL_DEFAULTS,
  useEditorStore,
  type LeftTab,
  type Panels,
} from "@/entities/editor"
import { Splitter, Tabs } from "@/shared/ui"
import { AssetsPanel } from "@/widgets/assets-panel"
import { BoardDialog } from "@/widgets/board-dialog"
import { Canvas } from "@/widgets/canvas"
import { DataPanel } from "@/widgets/data-panel"
import { ExportDialog } from "@/widgets/export-dialog"
import { Inspector } from "@/widgets/inspector"
import { OutputPanel } from "@/widgets/output-panel"
import { LayersPanel } from "@/widgets/layers-panel"
import { Player } from "@/widgets/player"
import { SettingsDialog } from "@/widgets/settings-dialog"
import { ShortcutsDialog } from "@/widgets/shortcuts-dialog"
import { StylesPanel } from "@/widgets/styles-panel"
import { Timeline } from "@/widgets/timeline"
import { Toolbar } from "@/widgets/toolbar"
import { useShortcuts } from "../model/use-shortcuts"
import s from "./editor-page.module.css"

const setPanels = (patch: Partial<Panels>) =>
  editorApi.getState().set({ panels: { ...editorApi.getState().panels, ...patch } })

/** The canvas keeps at least this much room when a panel grows. */
const CANVAS_MIN = 320

const LEFT_TABS: { value: LeftTab; label: string }[] = [
  { value: "layers", label: "Layers" },
  { value: "data", label: "Data" },
  { value: "styles", label: "Styles" },
  { value: "assets", label: "Assets" },
]

export function EditorPage() {
  useShortcuts()
  const leftTab = useEditorStore(s => s.leftTab)
  const error = useEditorStore(s => s.error)
  const playing = useEditorStore(s => s.playing)
  const dialog = useEditorStore(s => s.dialog)
  const timelineOpen = useEditorStore(s => s.timelineOpen)
  const outputOpen = useEditorStore(s => s.outputOpen)
  const panels = useEditorStore(s => s.panels)
  const widest = (other: number) => Math.max(200, window.innerWidth - other - CANVAS_MIN)
  return (
    <div
      className={s.page}
      style={{ gridTemplateColumns: `${panels.left}px minmax(0, 1fr) ${panels.right}px` }}
    >
      <Toolbar />
      <aside className={s.left}>
        <Tabs
          value={leftTab}
          tabs={LEFT_TABS}
          onChange={leftTab => editorApi.getState().set({ leftTab })}
        />
        <div className={s.leftBody}>
          {leftTab === "layers" && <LayersPanel />}
          {leftTab === "data" && <DataPanel />}
          {leftTab === "styles" && <StylesPanel />}
          {leftTab === "assets" && <AssetsPanel />}
        </div>
        <Splitter
          label='Layers panel width'
          edge='right'
          value={panels.left}
          min={200}
          max={Math.min(560, widest(panels.right))}
          initial={PANEL_DEFAULTS.left}
          onChange={left => setPanels({ left })}
        />
      </aside>
      <main className={s.center}>
        <Canvas />
        {timelineOpen && (
          <div className={s.dock} style={{ height: panels.timeline }}>
            <Splitter
              label='Timeline height'
              edge='top'
              value={panels.timeline}
              min={140}
              max={Math.max(140, window.innerHeight - 44 - 200)}
              initial={PANEL_DEFAULTS.timeline}
              onChange={timeline => setPanels({ timeline })}
            />
            <Timeline />
          </div>
        )}
        {outputOpen && (
          <div className={s.dock} style={{ height: panels.output }}>
            <Splitter
              label='Build output height'
              edge='top'
              value={panels.output}
              min={120}
              max={Math.max(120, window.innerHeight - 44 - 200)}
              initial={PANEL_DEFAULTS.output}
              onChange={output => setPanels({ output })}
            />
            <OutputPanel docked />
          </div>
        )}
        {error && (
          <div className={s.error} role='alert'>
            <strong>Preview error.</strong> {error}
            <button onClick={() => editorApi.getState().set({ error: null })}>Dismiss</button>
          </div>
        )}
      </main>
      <aside className={s.right}>
        <Inspector />
        <Splitter
          label='Inspector width'
          edge='left'
          value={panels.right}
          min={240}
          max={Math.min(560, widest(panels.left))}
          initial={PANEL_DEFAULTS.right}
          onChange={right => setPanels({ right })}
        />
      </aside>
      {playing && <Player />}
      {dialog === "board" && <BoardDialog />}
      {dialog === "export" && <ExportDialog />}
      {dialog === "shortcuts" && <ShortcutsDialog />}
      {dialog === "settings" && <SettingsDialog />}
    </div>
  )
}
