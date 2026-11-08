import { Plus, X } from "lucide-react"
import { useState } from "react"
import { DISPLAY_PRESETS } from "@/entities/board"
import { projectApi, useProjectStore } from "@/entities/project"
import { useSettings } from "@/shared/config"
import { IconButton } from "@/shared/ui"
import { addSize, deleteSize, renameSize, sizeLabel } from "../model/sizes"
import s from "./size-bar.module.css"

/**
 * The screen sizes this UI is built for, like breakpoints: the base and any others. Picking one
 * shows every screen at that size; layout and style edits made there stay there.
 */
export function SizeBar() {
  const sizes = useProjectStore(st => st.doc.sizes)
  const base = useProjectStore(st => st.doc.target.display)
  const active = useProjectStore(st => st.size)
  const pick = (id: string | null) => projectApi.getState().setSize(id)
  const current = sizes.find(sz => sz.id === active)
  const [renaming, setRenaming] = useState<string | null>(null)
  // an experiment for now: shown when Settings turns it on, or for a project that has sizes
  const enabled = useSettings(st => st.sizes)
  if (!enabled && !sizes.length) return null
  return (
    <div className={s.wrap}>
      <div className={s.bar} role='tablist' aria-label='Screen sizes'>
        <button
          role='tab'
          aria-selected={!active}
          title='The base size: every other size starts from it'
          onClick={() => pick(null)}
        >
          {sizeLabel(base)}
        </button>
        {sizes.map(sz =>
          renaming === sz.id ? (
            // in place: the desktop app's webview has no prompt()
            <input
              key={sz.id}
              className={s.rename}
              autoFocus
              defaultValue={sz.name}
              aria-label='Size name'
              onFocus={e => e.target.select()}
              onBlur={e => {
                renameSize(sz.id, e.target.value)
                setRenaming(null)
              }}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === "Enter") {
                  renameSize(sz.id, e.currentTarget.value)
                  setRenaming(null)
                }
                if (e.key === "Escape") setRenaming(null)
              }}
            />
          ) : (
            <button
              key={sz.id}
              role='tab'
              aria-selected={active === sz.id}
              title={`${sizeLabel(sz.target.display)} on ${sz.target.board} (double-click to rename)`}
              onClick={() => pick(sz.id)}
              onDoubleClick={() => setRenaming(sz.id)}
            >
              {sz.name}
            </button>
          ),
        )}
        <label className={s.add} title='Add a screen size'>
          <Plus />
          <select
            value=''
            aria-label='Add a screen size'
            onChange={e => e.target.value && addSize(DISPLAY_PRESETS[Number(e.target.value)])}
          >
            <option value='' disabled>
              Add a size…
            </option>
            {DISPLAY_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {current && (
          <IconButton label={`Remove ${current.name}`} onClick={() => deleteSize(current.id)}>
            <X />
          </IconButton>
        )}
      </div>
      {current && (
        <p className={s.note}>
          Layout, style and graphics changes now apply to {current.name} only.
        </p>
      )}
    </div>
  )
}
