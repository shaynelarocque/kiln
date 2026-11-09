import { ChevronDown } from "lucide-react"
import { deviceApi, useDevice } from "@/entities/device"
import { editorApi, useEditorStore } from "@/entities/editor"
import { build, stopBuild, toggleMonitor, toggleOutput } from "@/features/export-firmware"
import { newProject, openProject, saveProject, showHome } from "@/features/project-file"
import { useSettings } from "@/shared/config"
import { revealLogs } from "@/shared/lib/log"
import { Menu, type MenuItem } from "@/shared/ui"
import s from "./toolbar.module.css"

const open = (dialog: "board" | "export" | "settings" | "shortcuts") => () =>
  editorApi.getState().set({ dialog })

/**
 * Kiln's main menu, where Figma keeps its own: behind the logo. The same commands as the menu
 * bar, which a browser doesn't have.
 */
export function MainMenu() {
  const desktop = deviceApi.available()
  const running = useDevice(d => Boolean(d.job?.running))
  const monitoring = useDevice(d => Boolean(d.monitor && d.monitor.status !== "closed"))
  const timeline = useEditorStore(e => e.timelineOpen)
  const output = useEditorStore(e => e.outputOpen)
  const pixelGrid = useSettings(st => st.pixelGrid)

  const items: MenuItem[] = [
    { label: "Back to projects", keys: "⇧⌘H", onSelect: showHome },
    { label: "New project", keys: "⌘N", onSelect: () => newProject("blank") },
    { label: "Open…", keys: "⌘O", onSelect: openProject },
    { label: "Save", keys: "⌘S", onSelect: () => saveProject() },
    { label: "Save as…", keys: "⇧⌘S", onSelect: () => saveProject(true) },
    null,
    { label: "Board, display and pins…", onSelect: open("board") },
    { label: "Export code…", keys: "⌘E", onSelect: open("export") },
    ...(desktop
      ? [
          running
            ? { label: "Stop the build", keys: "⌘.", onSelect: stopBuild }
            : { label: "Build", keys: "⌘B", onSelect: () => build(false) },
          { label: "Build and flash", keys: "⌘U", onSelect: () => build(true), disabled: running },
          { label: "Serial monitor", keys: "⇧⌘M", onSelect: toggleMonitor, checked: monitoring },
        ]
      : []),
    null,
    { label: "Build output", keys: "⌘J", onSelect: toggleOutput, checked: output },
    {
      label: "Animations timeline",
      onSelect: () => editorApi.getState().set({ timelineOpen: !timeline }),
      checked: timeline,
    },
    {
      label: "Pixel grid",
      keys: "⇧'",
      onSelect: () => useSettings.getState().update({ pixelGrid: !pixelGrid }),
      checked: pixelGrid,
    },
    null,
    { label: "Settings…", keys: "⌘,", onSelect: open("settings") },
    { label: "Keyboard shortcuts", keys: "?", onSelect: open("shortcuts") },
    ...(desktop ? [{ label: "Show logs", onSelect: () => void revealLogs() }] : []),
  ]

  return (
    <Menu
      label='Main menu'
      className={s.mainMenu}
      trigger={
        <>
          <span className={s.logo} aria-hidden>
            ◆
          </span>
          <ChevronDown className={s.menuChevron} />
        </>
      }
      items={items}
    />
  )
}
