import { Clapperboard, Cpu, Download, FilePlus, FolderOpen, Keyboard, Play, Redo2, Save, Undo2 } from "lucide-react"
import { useMemo, useState } from "react"
import { findBoard, formatBytes, useBoards } from "@/entities/board"
import { editorApi, nodeBoxes, useEditorStore } from "@/entities/editor"
import { edit, useProjectStore } from "@/entities/project"
import { budgetFor } from "@/features/export-firmware"
import { useHistory } from "@/features/history"
import { ComponentMenu } from "@/features/components"
import { InsertBar } from "@/features/insert-widget"
import { newProject, openProject, saveProject } from "@/features/project-file"
import { Button, IconButton } from "@/shared/ui"
import s from "./toolbar.module.css"

export function Toolbar() {
  const project = useProjectStore(s => s.project)
  const dirty = useProjectStore(s => s.project !== s.saved)
  const history = useHistory()
  const { boards } = useBoards()
  const board = findBoard(boards, project.target.board)
  const rects = useEditorStore(s => s.rects)
  const boxes = useMemo(() => nodeBoxes(rects), [rects])
  const budget = budgetFor(project, board, boxes)
  const [naming, setNaming] = useState(false)
  const timelineOpen = useEditorStore(s => s.timelineOpen)
  const flash = budget.flash.used / budget.flash.total
  const ram = budget.ram.used / budget.ram.total

  return (
    <header className={s.bar} data-tauri-drag-region>
      <div className={s.group} data-tauri-drag-region>
        <span className={s.logo} aria-hidden>
          ◆
        </span>
        {naming ? (
          <input
            className={s.name}
            autoFocus
            defaultValue={project.name}
            onBlur={e => {
              const name = e.target.value.trim()
              if (name && name !== project.name) edit(d => void (d.name = name))
              setNaming(false)
            }}
            onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button className={s.title} onDoubleClick={() => setNaming(true)} title='Double-click to rename'>
            {project.name}
            {dirty && <span className={s.dirty} title='Unsaved changes' />}
          </button>
        )}
        <IconButton label='New project' onClick={newProject}>
          <FilePlus />
        </IconButton>
        <IconButton label='Open… (⌘O)' onClick={openProject}>
          <FolderOpen />
        </IconButton>
        <IconButton label='Save (⌘S)' onClick={() => saveProject()}>
          <Save />
        </IconButton>
        <span className={s.sep} />
        <IconButton label='Undo (⌘Z)' disabled={!history.canUndo} onClick={history.undo}>
          <Undo2 />
        </IconButton>
        <IconButton label='Redo (⇧⌘Z)' disabled={!history.canRedo} onClick={history.redo}>
          <Redo2 />
        </IconButton>
        <span className={s.sep} />
        <IconButton label='Animations timeline' active={timelineOpen} onClick={() => editorApi.getState().set({ timelineOpen: !timelineOpen })}>
          <Clapperboard />
        </IconButton>
        <IconButton label='Keyboard shortcuts (?)' onClick={() => editorApi.getState().set({ dialog: "shortcuts" })}>
          <Keyboard />
        </IconButton>
      </div>

      <div className={`${s.group} ${s.insert}`}>
        <InsertBar />
        <ComponentMenu />
      </div>

      <div className={s.group}>
        <button className={s.board} onClick={() => editorApi.getState().set({ dialog: "board" })} title='Board, display and pins'>
          <Cpu />
          <span>
            <strong>{board?.name ?? project.target.board}</strong>
            <small>
              {project.target.display.driver.toUpperCase()} {project.target.display.width}×{project.target.display.height}
            </small>
          </span>
          <span className={s.meters} title={`Flash ${formatBytes(budget.flash.used)} of ${formatBytes(budget.flash.total)} · RAM ${formatBytes(budget.ram.used)} of ${formatBytes(budget.ram.total)} (estimated)`}>
            <Meter label='Flash' value={flash} />
            <Meter label='RAM' value={ram} />
          </span>
        </button>
        <Button icon={<Play />} onClick={() => editorApi.getState().set({ playing: true })} title='Play (⌘↵)'>
          Play
        </Button>
        <Button icon={<Download />} variant='primary' onClick={() => editorApi.getState().set({ dialog: "export" })}>
          Export
        </Button>
      </div>
    </header>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  const tone = value > 0.9 ? s.hot : value > 0.7 ? s.warm : ""
  return (
    <span className={s.meter} aria-label={`${label} ${Math.round(value * 100)}%`}>
      <span className={tone} style={{ width: `${Math.min(100, value * 100)}%` }} />
    </span>
  )
}
