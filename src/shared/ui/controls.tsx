import { ChevronRight } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import s from "./controls.module.css"

/** Where a value change sits in a drag; see entities/project `edit`. */
export type Phase = "start" | "move" | "end"

export function Button({
  children,
  icon,
  variant = "default",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode
  variant?: "default" | "primary" | "ghost" | "danger"
}) {
  return (
    <button {...rest} className={`${s.button} ${s[variant]} ${rest.className ?? ""}`}>
      {icon}
      {children && <span>{children}</span>}
    </button>
  )
}

export function IconButton({
  label,
  active,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`${s.icon} ${active ? s.active : ""} ${rest.className ?? ""}`}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  children,
  wide,
}: {
  label: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={`${s.field} ${wide ? s.wide : ""}`}>
      <span className={s.fieldLabel}>{label}</span>
      <span className={s.fieldControl}>{children}</span>
    </label>
  )
}

type NumberProps = {
  value: number | null
  onChange: (value: number, phase?: Phase) => void
  min?: number
  max?: number
  step?: number
  /** shown after the number */
  unit?: string
  /** drag this left/right to scrub the value */
  prefix?: ReactNode
  /** stored value → shown value and back, e.g. 0-255 opacity as % */
  scale?: number
  placeholder?: string
  disabled?: boolean
  title?: string
}

const clamp = (v: number, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, v))

/**
 * A text field's uncommitted typing. It commits on blur, and also when the field goes away with
 * typing in it (a dialog closed by clicking outside unmounts the field before it ever blurs).
 * Escape throws the typing away and leaves the field, without letting a dialog close on it too.
 */
function usePending(
  shown: string,
  setDraft: (text: string) => void,
  commit: (text: string) => unknown,
) {
  const pending = useRef<string | null>(null)
  const latest = useRef(commit)
  latest.current = commit
  useEffect(() => {
    // a new value from outside (another layer selected, an undo) replaces the typing
    pending.current = null
    setDraft(shown)
  }, [shown, setDraft])
  useEffect(
    () => () => {
      if (pending.current !== null) latest.current(pending.current)
    },
    [],
  )
  return {
    type: (text: string) => {
      pending.current = text
      setDraft(text)
    },
    flush: () => {
      const text = pending.current
      pending.current = null
      if (text !== null) latest.current(text)
    },
    drop: () => void (pending.current = null),
    revert: (e: React.KeyboardEvent<HTMLElement>) => {
      e.stopPropagation()
      pending.current = null
      setDraft(shown)
      e.currentTarget.blur()
    },
  }
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  prefix,
  scale = 1,
  placeholder,
  disabled,
  title,
}: NumberProps) {
  const show = (v: number) => String(Math.round((v / scale) * 100) / 100)
  const shown = value === null ? "" : show(value)
  const [draft, setDraft] = useState(shown)
  // typed past min or max: says so for a moment in place of the unit, instead of quietly snapping
  const [limit, setLimit] = useState<string | null>(null)
  useEffect(() => {
    if (!limit) return
    const t = setTimeout(() => setLimit(null), 2500)
    return () => clearTimeout(t)
  }, [limit])
  const commit = (text: string) => {
    const n = parseFloat(text)
    if (!Number.isFinite(n)) return setDraft(shown)
    const typed = Math.round(n * scale)
    const v = clamp(typed, min, max)
    if (v !== typed) setLimit(`${v === max ? "max" : "min"} ${show(v)}`)
    // the stored value may not change (80 typed as 160 on a field already at 80), so show it here
    setDraft(show(v))
    onChange(v)
  }
  const pending = usePending(shown, setDraft, commit)

  const scrub = (e: React.PointerEvent) => {
    if (disabled || value === null) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const start = value
    let phase: Phase = "start"
    const move = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - startX) / 2) * step * (ev.shiftKey ? 10 : 1)
      onChange(clamp(Math.round(start + delta * scale), min, max), phase)
      phase = "move"
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      if (phase === "move") {
        const delta = Math.round((ev.clientX - startX) / 2) * step * (ev.shiftKey ? 10 : 1)
        onChange(clamp(Math.round(start + delta * scale), min, max), "end")
      }
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
  }

  return (
    <span className={`${s.number} ${disabled ? s.disabled : ""}`} title={title}>
      {prefix !== undefined && (
        <span className={s.prefix} onPointerDown={scrub}>
          {prefix}
        </span>
      )}
      <input
        value={draft}
        placeholder={placeholder ?? "–"}
        disabled={disabled}
        inputMode='decimal'
        onChange={e => pending.type(e.target.value)}
        onBlur={pending.flush}
        onKeyDown={e => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          if (e.key === "Escape") pending.revert(e)
          if ((e.key === "ArrowUp" || e.key === "ArrowDown") && value !== null) {
            e.preventDefault()
            pending.drop()
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
            onChange(clamp(Math.round(value + d * scale), min, max))
          }
        }}
      />
      {limit ? (
        <span className={s.limit} role='status'>
          {limit}
        </span>
      ) : (
        unit && <span className={s.unit}>{unit}</span>
      )}
    </span>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  multiline,
  mono,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  mono?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const pending = usePending(value, setDraft, text => text !== value && onChange(text))
  const props = {
    value: draft,
    placeholder,
    className: `${s.text} ${mono ? s.mono : ""}`,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      pending.type(e.target.value),
    onBlur: pending.flush,
    spellCheck: false,
  }
  return multiline ? (
    <textarea
      {...props}
      rows={Math.min(6, Math.max(2, draft.split("\n").length))}
      onKeyDown={e => e.key === "Escape" && pending.revert(e)}
    />
  ) : (
    <input
      {...props}
      onKeyDown={e => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        if (e.key === "Escape") pending.revert(e)
      }}
    />
  )
}

export type Option = { value: string; label: string }

export function Select({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string
  options: Option[]
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <select className={s.select} value={value} onChange={e => onChange(e.target.value)}>
      {placeholder !== undefined && <option value=''>{placeholder}</option>}
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      className={`${s.toggle} ${checked ? s.on : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

export type Token = { id: string; name: string; value: string }

/** "#rrggbb", or "$<token id>" to follow a colour token. */
export function ColorInput({
  value,
  onChange,
  tokens = [],
}: {
  value: string
  onChange: (v: string, phase?: Phase) => void
  tokens?: Token[]
}) {
  const token = value.startsWith("$") ? tokens.find(t => t.id === value.slice(1)) : undefined
  const hex = token?.value ?? (value.startsWith("#") ? value : "#000000")
  const picking = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef(onChange)
  latest.current = onChange
  // React's onChange fires on every tick of a colour picker; the native change event fires once,
  // when it closes, which is where the gesture (and its single undo step) ends.
  useEffect(() => {
    const el = input.current!
    const done = () => {
      if (picking.current) latest.current(el.value, "end")
      picking.current = false
    }
    el.addEventListener("change", done)
    return () => el.removeEventListener("change", done)
  }, [])
  return (
    <span className={s.color}>
      <label className={s.swatch} style={{ background: hex }}>
        <input
          ref={input}
          type='color'
          value={hex}
          onChange={e => {
            latest.current(e.target.value, picking.current ? "move" : "start")
            picking.current = true
          }}
        />
      </label>
      {token ? (
        <span className={s.tokenName}>{token.name}</span>
      ) : (
        <TextInput
          value={hex.toUpperCase()}
          onChange={v =>
            /^#?[0-9a-f]{6}$/i.test(v) && onChange(`#${v.replace("#", "").toLowerCase()}`)
          }
          mono
        />
      )}
      {tokens.length > 0 && (
        <select
          className={s.tokenPick}
          value={token ? value : ""}
          title='Use a colour token'
          onChange={e => onChange(e.target.value || hex)}
        >
          <option value=''>Custom</option>
          {tokens.map(t => (
            <option key={t.id} value={`$${t.id}`}>
              {t.name}
            </option>
          ))}
        </select>
      )}
    </span>
  )
}

export function Section({
  title,
  actions,
  children,
  collapsible = true,
  defaultOpen = true,
}: {
  title: ReactNode
  actions?: ReactNode
  children?: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  // a section with something folded inside says so; a closed one otherwise reads as empty
  const folds = collapsible && Boolean(children)
  return (
    <section className={s.section}>
      <header>
        <button
          type='button'
          className={s.sectionTitle}
          onClick={() => collapsible && setOpen(!open)}
          aria-expanded={folds ? open : undefined}
        >
          {title}
          {folds && <ChevronRight className={s.chevron} data-open={open || undefined} />}
        </button>
        <span className={s.sectionActions}>{actions}</span>
      </header>
      {open && children && <div className={s.sectionBody}>{children}</div>}
    </section>
  )
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
}: {
  value: T
  tabs: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className={s.tabs} role='tablist'>
      {tabs.map(t => (
        <button
          key={t.value}
          role='tab'
          aria-selected={t.value === value}
          className={t.value === value ? s.tabOn : ""}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [onClose])
  return (
    <div className={s.backdrop} onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`${s.dialog} ${wide ? s.dialogWide : ""}`} role='dialog' aria-label={title}>
        <header>
          <h2>{title}</h2>
          <IconButton label='Close' onClick={onClose}>
            ✕
          </IconButton>
        </header>
        <div className={s.dialogBody}>{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

export function Hint({ children, tone }: { children: ReactNode; tone?: "warn" | "error" | "ok" }) {
  return <p className={`${s.hint} ${tone ? s[tone] : ""}`}>{children}</p>
}

/**
 * A drag handle on a panel's edge. `edge` is the side of the panel it sits on, so dragging away
 * from the panel grows it. Arrow keys nudge it (Shift for bigger steps), Home and End go to the
 * limits, and a double-click puts it back to `initial`.
 */
export function Splitter({
  label,
  edge,
  value,
  min,
  max,
  initial,
  onChange,
}: {
  label: string
  edge: "left" | "right" | "top"
  value: number
  min: number
  max: number
  initial: number
  onChange: (value: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)))
  // which way the pointer moves to grow the panel
  const grow = edge === "right" ? 1 : -1
  const vertical = edge !== "top"
  return (
    <div
      role='separator'
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={s.splitter}
      data-edge={edge}
      data-dragging={dragging || undefined}
      onPointerDown={e => {
        if (e.button !== 0) return
        e.preventDefault()
        const el = e.currentTarget
        const start = vertical ? e.clientX : e.clientY
        const from = value
        el.setPointerCapture(e.pointerId)
        setDragging(true)
        // the whole page shows the resize cursor and selects no text while the drag lasts
        const { cursor, userSelect } = document.body.style
        document.body.style.cursor = vertical ? "col-resize" : "row-resize"
        document.body.style.userSelect = "none"
        const move = (ev: PointerEvent) =>
          onChange(clamp(from + grow * ((vertical ? ev.clientX : ev.clientY) - start)))
        const up = () => {
          el.removeEventListener("pointermove", move)
          el.removeEventListener("pointerup", up)
          el.removeEventListener("pointercancel", up)
          Object.assign(document.body.style, { cursor, userSelect })
          setDragging(false)
        }
        el.addEventListener("pointermove", move)
        el.addEventListener("pointerup", up)
        el.addEventListener("pointercancel", up)
      }}
      onDoubleClick={() => onChange(clamp(initial))}
      onKeyDown={e => {
        const step = e.shiftKey ? 48 : 8
        const keys: Record<string, number> = vertical
          ? { ArrowRight: grow * step, ArrowLeft: -grow * step }
          : { ArrowDown: grow * step, ArrowUp: -grow * step }
        if (e.key in keys) onChange(clamp(value + keys[e.key]))
        else if (e.key === "Home") onChange(min)
        else if (e.key === "End") onChange(max)
        else return
        // keep the editor's own arrow-key nudging out of it
        e.preventDefault()
        e.stopPropagation()
      }}
    />
  )
}
