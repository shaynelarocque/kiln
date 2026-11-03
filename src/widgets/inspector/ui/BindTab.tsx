import { Minus, Plus } from "lucide-react"
import { createVariable, safeFormat, type Binding, type Compare } from "@/entities/project"
import { BIND_FLAGS, BIND_STATES, COMPARE, STYLE_PROPS } from "@/shared/lvgl"
import { Button, Field, Hint, IconButton, NumberInput, Section, Select, TextInput } from "@/shared/ui"
import type { InspectorViewModel } from "../model/use-inspector"
import s from "./inspector.module.css"

const KIND_LABEL: Record<Binding["kind"], string> = {
  text: "Text",
  value: "Value",
  checked: "Checked",
  series: "Chart history",
  flag: "Visibility",
  state: "State",
  style: "Style property",
}

const NUMERIC_STYLE = STYLE_PROPS.filter(p => ["px", "opa", "angle", "scale", "int"].includes(p.type))

export function BindTab({ vm }: { vm: InspectorViewModel }) {
  const node = vm.node!
  const vars = vm.project.variables
  const kinds: Binding["kind"][] = [...vm.def!.bind, ...(node.checkable && !vm.def!.bind.includes("checked") ? (["checked"] as const) : []), "flag", "state", "style"]

  const add = (kind: Binding["kind"]) => {
    const variable = vars.find(v => v.type === "int")?.id ?? vars[0]?.id ?? ""
    const b: Binding =
      kind === "text"
        ? { kind, variable, format: vars.find(v => v.id === variable)?.type === "string" ? "%s" : "%d" }
        : kind === "flag"
          ? { kind, variable, flag: "LV_OBJ_FLAG_HIDDEN", compare: "eq", ref: 0 }
          : kind === "state"
            ? { kind, variable, state: "LV_STATE_CHECKED", compare: "eq", ref: 1 }
            : kind === "style"
              ? { kind, variable, prop: "translate_x", selector: "main:default", inMin: 0, inMax: 100, outMin: 0, outMax: 100 }
              : { kind, variable }
    vm.set(n => void n.bindings.push(b))
  }

  if (!vars.length)
    return (
      <Section title='Bindings' collapsible={false}>
        <Hint>Variables carry data from sensors, pins and code into the UI. Make one to bind it here.</Hint>
        <Button icon={<Plus />} onClick={() => vm.editProject(d => void d.variables.push(createVariable(`value_${d.variables.length + 1}`)))}>
          New variable
        </Button>
      </Section>
    )

  return (
    <Section
      title='Bindings'
      collapsible={false}
      actions={
        <span className={s.addMenu}>
          <Plus />
          <select value='' aria-label='Add binding' onChange={e => add(e.target.value as Binding["kind"])}>
            <option value='' disabled>
              Bind…
            </option>
            {kinds.map(k => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </span>
      }
    >
      {node.bindings.length === 0 && <Hint>Bind this {vm.def!.label.toLowerCase()} to a variable: values flow in from the board, and inputs flow back out.</Hint>}
      {node.bindings.map((b, i) => {
        const update = (patch: Partial<Binding>) => vm.set(n => void Object.assign(n.bindings[i], patch))
        const variable = vars.find(v => v.id === b.variable)
        return (
          <div key={i} className={s.card}>
            <div className={s.cardHead}>
              <strong>{KIND_LABEL[b.kind]}</strong>
              <IconButton label='Remove binding' onClick={() => vm.set(n => void n.bindings.splice(i, 1))}>
                <Minus />
              </IconButton>
            </div>
            <Field label='Variable'>
              <Select value={b.variable} options={vars.map(v => ({ value: v.id, label: v.name }))} onChange={v => update({ variable: v })} />
            </Field>
            {b.kind === "text" && (
              <>
                <Field label='Format'>
                  <TextInput value={b.format} onChange={format => update({ format })} mono />
                </Field>
                {variable && b.format && !safeFormat(b.format, variable.type) && (
                  <Hint tone='warn'>Needs exactly one {variable.type === "int" ? "%d" : "%s"}; until then the bare value shows.</Hint>
                )}
              </>
            )}
            {b.kind === "value" && <Hint>Two-way: the widget follows the variable, and dragging it sets the variable.</Hint>}
            {(b.kind === "flag" || b.kind === "state") && (
              <>
                <Field label={b.kind === "flag" ? "Set" : "Add state"}>
                  {b.kind === "flag" ? (
                    <Select value={b.flag} options={BIND_FLAGS} onChange={flag => update({ flag })} />
                  ) : (
                    <Select value={b.state} options={BIND_STATES} onChange={state => update({ state })} />
                  )}
                </Field>
                <Field label='When value'>
                  <span className={s.compare}>
                    <Select value={b.compare} options={COMPARE} onChange={c => update({ compare: c as Compare })} />
                    <NumberInput value={b.ref} onChange={ref => update({ ref })} />
                  </span>
                </Field>
              </>
            )}
            {b.kind === "style" && (
              <>
                <Field label='Property'>
                  <Select value={b.prop} options={NUMERIC_STYLE.map(p => ({ value: p.name, label: `${p.label} (${p.group})` }))} onChange={prop => update({ prop })} />
                </Field>
                <Field label='Selector'>
                  <TextInput value={b.selector} onChange={selector => update({ selector })} mono />
                </Field>
                <Field label='Map from'>
                  <span className={s.compare}>
                    <NumberInput value={b.inMin} onChange={inMin => update({ inMin })} />
                    <NumberInput value={b.inMax} onChange={inMax => update({ inMax })} />
                  </span>
                </Field>
                <Field label='to'>
                  <span className={s.compare}>
                    <NumberInput value={b.outMin} onChange={outMin => update({ outMin })} />
                    <NumberInput value={b.outMax} onChange={outMax => update({ outMax })} />
                  </span>
                </Field>
                <Hint>LVGL units: rotation in tenths of a degree, opacity 0-255, scale 256 = 100%.</Hint>
              </>
            )}
          </div>
        )
      })}
    </Section>
  )
}
