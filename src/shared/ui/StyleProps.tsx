import { Minus, Plus } from "lucide-react"
import { DEFAULT_FONT, FONT_SIZES, STYLE_GROUPS, STYLE_PROPS, TTF_SIZES, nearestFontSize, parseTtfFont, ttfFont, type StyleGroup, type StyleProp, type WidgetType } from "@/shared/lvgl"
import { ColorInput, Field, IconButton, NumberInput, Section, Select, Toggle, type Phase, type Token } from "./controls"
import s from "./style-props.module.css"

type Value = string | number | boolean
type Named = { id: string; name: string }

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

/** Montserrat at its built-in sizes, the Unscii pixel fonts, or an imported font at any size. */
function FontInput({ value, onChange, fonts }: { value: string; onChange: (v: Value, phase?: Phase) => void; fonts: Named[] }) {
  const ttf = parseTtfFont(value)
  const size = ttf?.size ?? Number(/(\d+)$/.exec(value)?.[1] ?? 14)
  const family = ttf ? ttf.id : value.startsWith("lv_font_unscii") ? value : "montserrat"
  const families = [
    { value: "montserrat", label: "Montserrat" },
    { value: "lv_font_unscii_8", label: "Unscii 8 (pixel)" },
    { value: "lv_font_unscii_16", label: "Unscii 16 (pixel)" },
    ...fonts.map(f => ({ value: f.id, label: f.name })),
    ...(ttf && !fonts.some(f => f.id === ttf.id) ? [{ value: ttf.id, label: "Missing font" }] : []),
  ]
  const pick = (f: string) =>
    onChange(f === "montserrat" ? `lv_font_montserrat_${nearestFontSize(size)}` : f.startsWith("lv_font_") ? f : ttfFont(f, Math.min(TTF_SIZES.max, Math.max(TTF_SIZES.min, size))))
  return (
    <span className={s.font}>
      <Select value={family} options={families} onChange={pick} />
      {family === "montserrat" && <Select value={String(size)} options={FONT_SIZES.map(n => ({ value: String(n), label: `${n} px` }))} onChange={n => onChange(`lv_font_montserrat_${n}`)} />}
      {ttf && <NumberInput value={size} min={TTF_SIZES.min} max={TTF_SIZES.max} unit='px' prefix='' onChange={(n, phase) => onChange(ttfFont(ttf.id, n), phase)} />}
    </span>
  )
}

export function StyleValueInput({
  prop,
  value,
  onChange,
  tokens,
  assets = [],
  fonts = [],
}: {
  prop: StyleProp
  value: Value
  onChange: (v: Value, phase?: Phase) => void
  tokens: Token[]
  assets?: Named[]
  /** imported fonts */
  fonts?: Named[]
}) {
  switch (prop.type) {
    case "color":
      return <ColorInput value={String(value)} onChange={onChange} tokens={tokens} />
    case "enum":
      return <Select value={String(value)} options={prop.options!} onChange={onChange} />
    case "font":
      return <FontInput value={String(value)} onChange={onChange} fonts={fonts} />
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
  fonts,
  widget,
}: {
  props: Record<string, Value>
  /** undefined removes the prop */
  onChange: (name: string, value: Value | undefined, phase?: Phase) => void
  tokens: Token[]
  assets?: Named[]
  fonts?: Named[]
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
                <Field key={prop.name} label={prop.label} wide={prop.type === "font"}>
                  <StyleValueInput prop={prop} value={props[prop.name]} onChange={(v, phase) => onChange(prop.name, v, phase)} tokens={tokens} assets={assets} fonts={fonts} />
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
