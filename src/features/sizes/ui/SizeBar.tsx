import { Plus, X } from "lucide-react"
import { DISPLAY_PRESETS } from "@/entities/board"
import { projectApi, useProjectStore } from "@/entities/project"
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
        {sizes.map(sz => (
          <button
            key={sz.id}
            role='tab'
            aria-selected={active === sz.id}
            title={`${sizeLabel(sz.target.display)} on ${sz.target.board} (double-click to rename)`}
            onClick={() => pick(sz.id)}
            onDoubleClick={() => {
              const name = prompt("Name this size", sz.name)
              if (name) renameSize(sz.id, name)
            }}
          >
            {sz.name}
          </button>
        ))}
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
        <p className={s.note}>Layout and style changes now apply to {current.name} only.</p>
      )}
    </div>
  )
}
