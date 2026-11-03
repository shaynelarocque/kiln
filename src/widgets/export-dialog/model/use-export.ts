import { useEffect, useMemo, useState } from "react"
import { findBoard, useBoards } from "@/entities/board"
import { editorApi, nodeBoxes, useEditorStore } from "@/entities/editor"
import { slug, useProjectStore } from "@/entities/project"
import {
  generateFirmware,
  pickFolder,
  pioInfo,
  pioPorts,
  pioRun,
  writeProject,
  type SerialPort,
} from "@/features/export-firmware"
import { download } from "@/features/project-file"
import { inTauri } from "@/shared/lib/tauri"
import { zip } from "@/shared/lib/zip"

const folderKey = (name: string) => `kiln:export:${name}`

/** View-model for the export dialog: the generated files, where they go, and building them. */
export function useExport() {
  const project = useProjectStore(s => s.project)
  const { boards } = useBoards()
  const board = findBoard(boards, project.target.board)
  const rects = useEditorStore(s => s.rects)
  const files = useMemo(
    () => generateFirmware(project, board, nodeBoxes(rects)),
    [project, board, rects],
  )
  const [selected, setSelected] = useState("src/ui/ui.c")
  const [folder, setFolder] = useState<string | null>(() =>
    localStorage.getItem(folderKey(project.name)),
  )
  const [status, setStatus] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [running, setRunning] = useState<null | "build" | "upload">(null)
  const [pio, setPio] = useState<{ path: string | null; version: string | null } | null>(null)
  const [ports, setPorts] = useState<SerialPort[]>([])
  const [port, setPort] = useState("")
  const desktop = inTauri()

  useEffect(() => {
    if (!desktop) return
    pioInfo().then(setPio)
    pioPorts().then(setPorts, () => setPorts([]))
  }, [desktop])

  const exportTo = async (dir: string) => {
    try {
      const written = await writeProject(dir, files)
      localStorage.setItem(folderKey(project.name), dir)
      setFolder(dir)
      const kept = files.length - written.length
      setStatus(
        `Wrote ${written.length} files to ${dir}${kept ? ` (kept your ${kept} existing)` : ""}.`,
      )
      return true
    } catch (e) {
      setStatus(`Export failed: ${e}`)
      return false
    }
  }

  const run = async (upload: boolean) => {
    if (!folder || running) return
    if (!(await exportTo(folder))) return
    setRunning(upload ? "upload" : "build")
    setLog([
      `$ pio run${upload ? " -t upload" : ""}${upload && port ? ` --upload-port ${port}` : ""}`,
    ])
    try {
      const code = await pioRun(folder, upload, port || null, e => {
        if (e.kind === "line") setLog(l => [...l.slice(-2000), e.text])
      })
      setStatus(
        code === 0
          ? upload
            ? "Flashed. Open a serial monitor at 115200 to see LVGL's log."
            : "Built. Ready to flash."
          : `pio exited with ${code}. See the log.`,
      )
    } catch (e) {
      setLog(l => [...l, String(e)])
      setStatus(String(e))
    } finally {
      setRunning(null)
    }
  }

  return {
    project,
    board,
    files,
    selected,
    file: files.find(f => f.path === selected) ?? files[0],
    select: setSelected,
    folder,
    status,
    log,
    running,
    pio,
    ports,
    port,
    setPort,
    desktop,
    close: () => editorApi.getState().set({ dialog: null }),
    chooseFolder: async () => {
      const dir = await pickFolder()
      if (dir) await exportTo(dir)
    },
    exportAgain: () => folder && exportTo(folder),
    build: () => run(false),
    upload: () => run(true),
    refreshPorts: () => pioPorts().then(setPorts, () => setPorts([])),
    downloadZip: () =>
      download(
        `${slug(project.name)}.zip`,
        zip(files.map(f => ({ path: `${slug(project.name)}/${f.path}`, content: f.content }))),
        "application/zip",
      ),
    copy: () =>
      navigator.clipboard.writeText((files.find(f => f.path === selected) ?? files[0]).content),
  }
}
