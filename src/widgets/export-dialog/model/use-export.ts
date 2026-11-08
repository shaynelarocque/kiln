import { useEffect, useMemo, useState } from "react"
import { findBoard, useBoards } from "@/entities/board"
import { editorApi, nodeBoxes, useEditorStore } from "@/entities/editor"
import { slug, useProjectStore } from "@/entities/project"
import {
  build,
  exportFolder,
  exportTo,
  generateFirmware,
  pickFolder,
  pioInfo,
} from "@/features/export-firmware"
import { download } from "@/features/project-file"
import { inTauri } from "@/shared/lib/tauri"
import { zip } from "@/shared/lib/zip"

/**
 * View-model for the export dialog: the generated files and where they go. Building and
 * flashing start here but run in the background, so the dialog closes and the log takes over.
 */
export function useExport() {
  const project = useProjectStore(s => s.project)
  const size = useProjectStore(s => s.size)
  const { boards } = useBoards()
  const board = findBoard(boards, project.target.board)
  const rects = useEditorStore(s => s.rects)
  const files = useMemo(
    () => generateFirmware(project, board, nodeBoxes(rects)),
    [project, board, rects],
  )
  const [selected, setSelected] = useState("src/ui/ui.c")
  const [folder, setFolder] = useState<string | null>(() => exportFolder())
  useEffect(() => setFolder(exportFolder()), [project.name, size])
  const [status, setStatus] = useState<string | null>(null)
  const [pio, setPio] = useState<{ path: string | null; version: string | null } | null>(null)
  const desktop = inTauri()
  const close = () => editorApi.getState().set({ dialog: null })

  useEffect(() => {
    if (desktop) pioInfo().then(setPio)
  }, [desktop])

  const writeTo = async (dir: string) => {
    try {
      const { written, kept } = await exportTo(dir, files)
      setFolder(dir)
      setStatus(`Wrote ${written} files to ${dir}${kept ? ` (kept your ${kept} existing)` : ""}.`)
      return true
    } catch (e) {
      setStatus(`Export failed: ${e}`)
      return false
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
    pio,
    desktop,
    close,
    chooseFolder: async () => {
      const dir = await pickFolder()
      if (dir) await writeTo(dir)
    },
    exportAgain: () => folder && writeTo(folder),
    build: () => (close(), build(false)),
    flash: () => (close(), build(true)),
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
