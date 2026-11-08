import { editorApi } from "@/entities/editor"
import { Dialog } from "@/shared/ui"
import s from "./shortcuts.module.css"

const GROUPS: [string, [string, string][]][] = [
  [
    "Canvas",
    [
      ["Pan", "Space-drag · scroll"],
      ["Zoom", "Pinch · ⌘-scroll · + / −"],
      ["Zoom to fit / selection / 100%", "⇧1 / ⇧2 / ⇧0"],
      ["Pixel grid (zoomed in)", "⇧'"],
      ["Select deeper / edit text", "Double-click"],
      ["Select deepest", "⌘-click"],
      ["Add to selection", "⇧-click"],
      ["Select an area", "Drag on a screen's background"],
      ["Ignore snapping", "⌥ while dragging"],
      ["Keep proportions", "⇧ while resizing"],
    ],
  ],
  [
    "Edit",
    [
      ["Undo / redo", "⌘Z / ⇧⌘Z"],
      ["Copy / cut / paste", "⌘C / ⌘X / ⌘V"],
      ["Duplicate", "⌘D"],
      ["Group in a container", "⌘G"],
      ["Select siblings", "⌘A"],
      ["Delete", "⌫"],
      ["Nudge (×10)", "Arrows (⇧)"],
      ["Bring forward / back", "] / ["],
      ["Select parent", "Esc"],
    ],
  ],
  [
    "Arrange",
    [
      ["Align left / right", "⌥A / ⌥D"],
      ["Align top / bottom", "⌥W / ⌥S"],
      ["Align centres", "⌥H / ⌥V"],
      ["Distribute spacing", "⌃⌥H / ⌃⌥V"],
    ],
  ],
  [
    "Project",
    [
      ["Save / save as", "⌘S / ⇧⌘S"],
      ["Open", "⌘O"],
      ["Play", "⌘↵"],
      ["Leave Play", "Esc"],
      ["This sheet", "?"],
    ],
  ],
]

export function ShortcutsDialog() {
  return (
    <Dialog title='Keyboard shortcuts' onClose={() => editorApi.getState().set({ dialog: null })}>
      <div className={s.grid}>
        {GROUPS.map(([title, rows]) => (
          <section key={title}>
            <h3>{title}</h3>
            {rows.map(([what, keys]) => (
              <div key={what} className={s.row}>
                <span>{what}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  )
}
