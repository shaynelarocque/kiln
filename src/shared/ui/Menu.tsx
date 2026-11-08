import { Check } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import s from "./menu.module.css"

/** One command in a menu; null draws a separator. */
export type MenuItem = {
  label: string
  /** the shortcut, shown on the right */
  keys?: string
  onSelect: () => unknown
  disabled?: boolean
  /** a toggle's state: shows a check when true */
  checked?: boolean
} | null

/**
 * A button that drops down a list of commands. Arrows move through them, Enter runs one, and
 * Escape or a click elsewhere closes it, without the editor's own keys seeing any of that.
 */
export function Menu({
  label,
  trigger,
  items,
  className,
}: {
  label: string
  trigger: ReactNode
  items: MenuItem[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", escape, true)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", escape, true)
    }
  }, [open])

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    // arrows nudge the selection on the canvas otherwise
    e.preventDefault()
    e.stopPropagation()
    const buttons = [...list.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <span className={`${s.root} ${className ?? ""}`} ref={root}>
      <button
        className={s.trigger}
        aria-haspopup='menu'
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div className={s.menu} role='menu' aria-label={label} ref={list} onKeyDown={move}>
          {items.map((item, i) =>
            item ? (
              <button
                key={i}
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={item.checked}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                <span className={s.check}>{item.checked && <Check />}</span>
                <span className={s.label}>{item.label}</span>
                {item.keys && <kbd>{item.keys}</kbd>}
              </button>
            ) : (
              <hr key={i} />
            ),
          )}
        </div>
      )}
    </span>
  )
}
