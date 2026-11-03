import { Minus, Plus } from "lucide-react"
import { DEFAULT_FONT, FONTS, STYLE_GROUPS, STYLE_PROPS, type StyleGroup, type StyleProp, type WidgetType } from "@/shared/lvgl"
import { ColorInput, Field, IconButton, NumberInput, Section, Select, Toggle, type Phase, type Token } from "./controls"
import s from "./style-props.module.css"

type Value = string | number | boolean

/** Which groups make sense for a widget; the rest stay out of the way. */
const RELEVANT: Partial<Record<StyleGroup, WidgetType[]>> = {
  arc: ["arc", "spinner"],
  line: ["scale", "chart"],
  image: ["image"],
}

/** How a prop is shown: stored in LVGL units, displayed in human ones. */
export const DISPLAY: Record<string, { scale: number; unit?: string; min?: number; max?: number; step?: number }> = {
  opa: { scale: 2.55, unit: "%", min: 0, max: 255 },
  px: { scale: 1, unit: "px" },
  int: { scale: 1 },
  angle: { scale: 10, unit: "°" },
  scale: { scale: 2.56, unit: "%", min: 0 },
}

export function defaultFor(prop: StyleProp, assets: { id: string }[] = []): Value {
  switch (prop.type) {
    case "color":
      return "#ffffff"
    case "opa":
      return 255
    case "scale":
      return 256
    case "enum":
      return prop.options![0].value
    case "font":
      return DEFAULT_FONT
    case "bool":
      return true
    case "image":
      return assets[0]?.id ?? ""
    default:
      return 0
  }
}

export function StyleValueInput({
  prop,
  value,
  onChange,
  tokens,
  assets = [],
}: {
  prop: StyleProp
  value: Value
  onChange: (v: Value, phase?: Phase) => void
  tokens: Token[]
  assets?: { id: string; name: string }[]
}) {
  switch (prop.type) {
    case "color":
      return <ColorInput value={String(value)} onChange={onChange} tokens={tokens} />
    case "enum":
      return <Select value={String(value)} options={prop.options!} onChange={onChange} />
    case "font":
      return <Select value={String(value)} options={FONTS} onChange={onChange} />
    case "bool":
      return <Toggle checked={Boolean(value)} onChange={onChange} />
    case "image":
      return <Select value={String(value)} options={assets.map(a => ({ value: a.id, label: a.name }))} onChange={onChange} placeholder='None' />
    default: {
      const d = DISPLAY[prop.type]
      return <NumberInput value={Number(value)} onChange={onChange} scale={d.scale} unit={d.unit} min={prop.min ?? d.min} max={prop.max ?? d.max} prefix='' />
    }
  }
}

/** Edits a style's props, grouped like Figma's design panel; empty groups collapse to a +. */
export function StyleProps({
  props,
  onChange,
  tokens,
  assets,
  widget,
}: {
  props: Record<string, Value>
  /** undefined removes the prop */
  onChange: (name: string, value: Value | undefined, phase?: Phase) => void
  tokens: Token[]
  assets?: { id: string; name: string }[]
  widget?: WidgetType
}) {
  const groups = STYLE_GROUPS.filter(g => !widget || !RELEVANT[g.value] || RELEVANT[g.value]!.includes(widget))
  return (
    <>
      {groups.map(group => {
        const all = STYLE_PROPS.filter(p => p.group === group.value)
        const set = all.filter(p => props[p.name] !== undefined)
        const unset = all.filter(p => props[p.name] === undefined)
        return (
          <Section
            key={group.value}
            title={<span className={set.length ? "" : s.idle}>{group.label}</span>}
            collapsible={false}
            actions={
              unset.length > 0 && (
                <span className={s.add}>
                  <Plus />
                  <select
                    aria-label={`Add ${group.label.toLowerCase()} property`}
                    value=''
                    onChange={e => {
                      const prop = all.find(p => p.name === e.target.value)
                      if (prop) onChange(prop.name, defaultFor(prop, assets))
                    }}
                  >
                    <option value='' disabled>
                      Add…
                    </option>
                    {unset.map(p => (
                      <option key={p.name} value={p.name}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </span>
              )
            }
          >
            {set.length > 0 &&
              set.map(prop => (
                <Field key={prop.name} label={prop.label}>
                  <StyleValueInput prop={prop} value={props[prop.name]} onChange={(v, phase) => onChange(prop.name, v, phase)} tokens={tokens} assets={assets} />
                  <IconButton label={`Remove ${prop.label.toLowerCase()}`} className={s.remove} onClick={() => onChange(prop.name, undefined)}>
                    <Minus />
                  </IconButton>
                </Field>
              ))}
          </Section>
        )
      })}
    </>
  )
}
