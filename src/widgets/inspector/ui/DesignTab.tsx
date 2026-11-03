import { Columns3, Minus, Plus, Rows3 } from "lucide-react"
import type { Layout } from "@/entities/project"
import { ALIGN, EASINGS, FLEX_ALIGN, FLEX_FLOW, PARTS, STATES, SYMBOLS, STYLE_PROPS, TRANSITION_PROPS, type Coord, type Easing, type WidgetProp } from "@/shared/lvgl"
import { ColorInput, Field, Hint, IconButton, NumberInput, Section, Select, StyleProps, TextInput, Toggle } from "@/shared/ui"
import type { InspectorViewModel } from "../model/use-inspector"
import { ComponentSection } from "./ComponentSection"
import s from "./inspector.module.css"

export function DesignTab({ vm }: { vm: InspectorViewModel }) {
  const node = vm.node!
  const isScreen = !vm.parent
  return (
    <>
      {!isScreen && <LayoutSection vm={vm} />}
      <ComponentSection vm={vm} />
      {(vm.def!.container || isScreen) && !node.component && <AutoLayoutSection vm={vm} />}
      {vm.def!.props.length > 0 && !node.component && (
        <Section title={vm.def!.label}>
          {vm.def!.props.map(p => (
            <PropField key={p.key} prop={p} vm={vm} />
          ))}
        </Section>
      )}
      <SelectorBar vm={vm} />
      <StyleProps
        props={node.style[vm.selector] ?? {}}
        onChange={vm.setStyle}
        tokens={vm.tokens}
        assets={vm.assets}
        fonts={vm.fonts}
        widget={node.widget}
      />
      <ClassesSection vm={vm} />
      <TransitionSection vm={vm} />
      <BehaviorSection vm={vm} />
    </>
  )
}

/** px, %, or (for sizes) LVGL's size-to-content. */
function CoordInput({ value, onChange, label, allowContent }: { value: Coord; onChange: (v: Coord, phase?: "start" | "move" | "end") => void; label: string; allowContent?: boolean }) {
  const unit = value === "content" ? "auto" : typeof value === "string" ? "%" : "px"
  const n = typeof value === "number" ? value : value === "content" ? null : parseFloat(value)
  return (
    <span className={s.coord}>
      <NumberInput
        value={n}
        prefix={label}
        placeholder='auto'
        disabled={unit === "auto"}
        onChange={(v, phase) => onChange(unit === "%" ? (`${v}%` as Coord) : v, phase)}
      />
      <select
        className={s.unit}
        value={unit}
        aria-label={`${label} unit`}
        onChange={e => onChange(e.target.value === "auto" ? "content" : e.target.value === "%" ? (`${n ?? 100}%` as Coord) : Math.round(n ?? 100))}
      >
        <option value='px'>px</option>
        <option value='%'>%</option>
        {allowContent && <option value='auto'>auto</option>}
      </select>
    </span>
  )
}

function LayoutSection({ vm }: { vm: InspectorViewModel }) {
  const { layout } = vm.node!
  const inFlex = Boolean(vm.parent?.layout.flex)
  const set = <K extends keyof Layout>(key: K) => (v: Layout[K], phase?: "start" | "move" | "end") => vm.setLayout(key, v, phase)
  return (
    <Section title='Layout'>
      {inFlex ? (
        <Hint>Placed by the parent's auto layout. Drag on the canvas to reorder.</Hint>
      ) : (
        <div className={s.alignRow}>
          <div className={s.alignGrid} role='radiogroup' aria-label='Align to parent'>
            {ALIGN.map(a => (
              <button
                key={a.value}
                role='radio'
                aria-checked={layout.align === a.value}
                title={a.label}
                className={layout.align === a.value ? s.alignOn : ""}
                onClick={() => vm.set(n => void (n.layout.align = a.value))}
              />
            ))}
          </div>
          <div className={s.xy}>
            <CoordInput label='X' value={layout.x} onChange={set("x")} />
            <CoordInput label='Y' value={layout.y} onChange={set("y")} />
          </div>
        </div>
      )}
      <div className={s.pair}>
        <CoordInput label='W' value={layout.w} onChange={set("w")} allowContent />
        <CoordInput label='H' value={layout.h} onChange={set("h")} allowContent />
      </div>
      {inFlex && (
        <Field label='Fill space'>
          <NumberInput value={layout.grow ?? 0} min={0} max={10} onChange={(v, phase) => vm.setLayout("grow", v || undefined, phase)} title='flex-grow' prefix='' />
        </Field>
      )}
    </Section>
  )
}

function AutoLayoutSection({ vm }: { vm: InspectorViewModel }) {
  const flex = vm.node!.layout.flex
  const pad = (name: string) => Number(vm.mainStyle(name) ?? 0)
  return (
    <Section
      title='Auto layout'
      actions={
        <IconButton
          label={flex ? "Remove auto layout" : "Add auto layout"}
          onClick={() =>
            vm.set(n => {
              n.layout.flex = flex ? undefined : { flow: "LV_FLEX_FLOW_COLUMN", main: "LV_FLEX_ALIGN_START", cross: "LV_FLEX_ALIGN_CENTER", track: "LV_FLEX_ALIGN_CENTER" }
            })
          }
        >
          {flex ? <Minus /> : <Plus />}
        </IconButton>
      }
    >
      {flex && (
        <>
          <div className={s.segmented}>
            {[
              { flow: "LV_FLEX_FLOW_ROW", icon: <Columns3 />, label: "Row" },
              { flow: "LV_FLEX_FLOW_COLUMN", icon: <Rows3 />, label: "Column" },
            ].map(o => (
              <button key={o.flow} aria-pressed={flex.flow.startsWith(o.flow)} onClick={() => vm.set(n => void (n.layout.flex!.flow = o.flow))}>
                {o.icon} {o.label}
              </button>
            ))}
          </div>
          <Field label='Flow'>
            <Select value={flex.flow} options={FLEX_FLOW} onChange={v => vm.set(n => void (n.layout.flex!.flow = v))} />
          </Field>
          <Field label='Main axis'>
            <Select value={flex.main} options={FLEX_ALIGN} onChange={v => vm.set(n => void (n.layout.flex!.main = v))} />
          </Field>
          <Field label='Cross axis'>
            <Select value={flex.cross} options={FLEX_ALIGN.slice(0, 3)} onChange={v => vm.set(n => void (n.layout.flex!.cross = v, n.layout.flex!.track = v))} />
          </Field>
          <div className={s.pair}>
            <NumberInput prefix='Gap' value={pad(flex.flow.includes("COLUMN") ? "pad_row" : "pad_column")} min={0} unit='px' onChange={(v, phase) => vm.setMainStyle(flex.flow.includes("COLUMN") ? "pad_row" : "pad_column", v, phase)} />
            <NumberInput
              prefix='Pad'
              value={pad("pad_top")}
              min={0}
              unit='px'
              title='Padding on all sides'
              onChange={(v, phase) => vm.set(n => {
                const m = (n.style["main:default"] ??= {})
                m.pad_top = m.pad_bottom = m.pad_left = m.pad_right = v
              }, phase)}
            />
          </div>
        </>
      )}
    </Section>
  )
}

function PropField({ prop, vm }: { prop: WidgetProp; vm: InspectorViewModel }) {
  const value = vm.node!.props[prop.key]
  const bound = prop.key === "text" && vm.node!.bindings.some(b => b.kind === "text")
  let control: React.ReactNode
  switch (prop.type) {
    case "text":
    case "lines":
      control = (
        <span className={s.textWithSymbols}>
          <TextInput value={String(value ?? "")} onChange={v => vm.setProp(prop.key, v)} multiline={prop.type === "lines" || String(value).includes("\n")} />
          <select className={s.symbols} value='' aria-label='Insert an icon' title='Insert an LVGL icon' onChange={e => vm.setProp(prop.key, `${value ?? ""}${String.fromCodePoint(Number(e.target.value))}`)}>
            <option value='' disabled>
              Icon
            </option>
            {SYMBOLS.map(sym => (
              <option key={sym.name} value={sym.cp}>
                {sym.name.replace("LV_SYMBOL_", "").toLowerCase().replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </span>
      )
      break
    case "bool":
      control = <Toggle checked={Boolean(value)} onChange={v => vm.setProp(prop.key, v)} />
      break
    case "enum":
      control = <Select value={String(value)} options={prop.options!} onChange={v => vm.setProp(prop.key, v)} />
      break
    case "color":
      control = <ColorInput value={String(value)} onChange={(v, phase) => vm.setProp(prop.key, v, phase)} />
      break
    case "image":
      control = <Select value={String(value ?? "")} options={vm.assets.map(a => ({ value: a.id, label: a.name }))} onChange={v => vm.setProp(prop.key, v || null)} placeholder='None' />
      break
    default:
      control = <NumberInput value={Number(value)} min={prop.min} max={prop.max} onChange={(v, phase) => vm.setProp(prop.key, v, phase)} prefix='' />
  }
  return (
    <>
      <Field label={prop.label} wide={prop.type === "lines"}>
        {control}
      </Field>
      {bound && <Hint>Bound to a variable: this text shows until the first value arrives.</Hint>}
    </>
  )
}

function SelectorBar({ vm }: { vm: InspectorViewModel }) {
  const parts = PARTS.filter(p => vm.def!.parts.includes(p.value))
  const dot = (part: string, state?: string) => [...vm.styled].some(k => k.startsWith(`${part}:`) && (!state || k.split(":")[1].split("+").includes(state)))
  return (
    <div className={s.selector}>
      <div className={s.selectorHead}>
        <span>Style</span>
        <code title='The LVGL selector these styles apply to'>{vm.selector}</code>
      </div>
      {parts.length > 1 && (
        <div className={s.chips} role='radiogroup' aria-label='Part'>
          {parts.map(p => (
            <button key={p.value} role='radio' aria-checked={vm.part === p.value} onClick={() => vm.setSelector(p.value, vm.states)}>
              {p.label}
              {dot(p.value) && <i />}
            </button>
          ))}
        </div>
      )}
      <div className={s.chips} aria-label='States (combine for :checked:pressed and so on)'>
        {STATES.map(st => {
          const on = st.value === "default" ? vm.states.includes("default") : vm.states.includes(st.value)
          return (
            <button
              key={st.value}
              aria-pressed={on}
              onClick={() => {
                if (st.value === "default") return vm.setSelector(vm.part, ["default"])
                const next = on ? vm.states.filter(x => x !== st.value) : [...vm.states.filter(x => x !== "default"), st.value]
                vm.setSelector(vm.part, next.length ? next : ["default"])
              }}
            >
              {st.label}
              {dot(vm.part, st.value) && <i />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ClassesSection({ vm }: { vm: InspectorViewModel }) {
  const node = vm.node!
  const styles = vm.project.styles
  return (
    <Section title='Shared styles' defaultOpen={node.classes.length > 0}>
      {styles.length === 0 && <Hint>Make reusable styles in the Styles tab, like CSS classes.</Hint>}
      {node.classes.map((c, i) => (
        <Field key={i} label={styles.find(x => x.id === c.style)?.name ?? "missing"}>
          <code className={s.sel}>{c.selector}</code>
          <IconButton label='Remove style' onClick={() => vm.set(n => void n.classes.splice(i, 1))}>
            <Minus />
          </IconButton>
        </Field>
      ))}
      {styles.length > 0 && (
        <Field label='Add'>
          <Select value='' placeholder={`Apply to ${vm.selector}…`} options={styles.map(x => ({ value: x.id, label: x.name }))} onChange={id => id && vm.set(n => void n.classes.push({ style: id, selector: vm.selector }))} />
        </Field>
      )}
    </Section>
  )
}

function TransitionSection({ vm }: { vm: InspectorViewModel }) {
  const t = vm.node!.transition
  const styledProps = new Set(Object.values(vm.node!.style).flatMap(p => Object.keys(p)))
  const options = TRANSITION_PROPS.filter(p => styledProps.has(p) || t?.props.includes(p))
  return (
    <Section
      title='Transition'
      defaultOpen={Boolean(t)}
      actions={
        <IconButton
          label={t ? "Remove transition" : "Add transition"}
          onClick={() => vm.set(n => void (n.transition = t ? undefined : { props: options.slice(0, 4), duration: 200, delay: 0, easing: "ease-out" }))}
        >
          {t ? <Minus /> : <Plus />}
        </IconButton>
      }
    >
      {t ? (
        <>
          <Hint>Animates these properties whenever the state changes, like a CSS transition.</Hint>
          <div className={s.chips}>
            {(options.length ? options : TRANSITION_PROPS.slice(0, 8)).map(p => (
              <button
                key={p}
                aria-pressed={t.props.includes(p)}
                onClick={() => vm.set(n => void (n.transition!.props = t.props.includes(p) ? t.props.filter(x => x !== p) : [...t.props, p]))}
              >
                {STYLE_PROPS.find(x => x.name === p)?.label} <small>{STYLE_PROPS.find(x => x.name === p)?.group}</small>
              </button>
            ))}
          </div>
          <div className={s.pair}>
            <NumberInput prefix='Time' unit='ms' value={t.duration} min={0} step={10} onChange={(v, phase) => vm.set(n => void (n.transition!.duration = v), phase)} />
            <NumberInput prefix='Delay' unit='ms' value={t.delay} min={0} step={10} onChange={(v, phase) => vm.set(n => void (n.transition!.delay = v), phase)} />
          </div>
          <Field label='Easing'>
            <Select value={t.easing} options={EASINGS.filter(e => !["ease"].includes(e.value))} onChange={v => vm.set(n => void (n.transition!.easing = v as Easing))} />
          </Field>
        </>
      ) : (
        <Hint>Style a Pressed or Checked state, then add a transition to animate between them.</Hint>
      )}
    </Section>
  )
}

function BehaviorSection({ vm }: { vm: InspectorViewModel }) {
  const node = vm.node!
  const flag = (key: "hidden" | "checkable" | "scrollable" | "checked" | "disabled", label: string, hint?: string) => (
    <Field label={label}>
      <Toggle checked={Boolean(node[key])} onChange={v => vm.set(n => void (n[key] = v || undefined))} />
      {hint && <span className={s.hint}>{hint}</span>}
    </Field>
  )
  return (
    <Section title='Behavior' defaultOpen={false}>
      {flag("hidden", "Hidden")}
      <Field label='Clickable'>
        <Select
          value={node.clickable === undefined ? "" : String(node.clickable)}
          options={[
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]}
          placeholder="Widget's default"
          onChange={v => vm.set(n => void (n.clickable = v === "" ? undefined : v === "true"))}
        />
      </Field>
      {flag("checkable", "Toggles", "click flips Checked")}
      {(node.widget === "container" || node.widget === "screen") && flag("scrollable", "Scrolls", "overflow scrolls instead of clipping")}
      {flag("checked", "Checked")}
      {flag("disabled", "Disabled")}
      <Field label='C name'>
        <code className={s.sel}>{vm.cName}</code>
      </Field>
    </Section>
  )
}

