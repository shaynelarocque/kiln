import { Minus, Plus } from "lucide-react"
import { newId, type Action, type Interaction } from "@/entities/project"
import { EVENTS, SCREEN_LOAD_ANIM } from "@/shared/lvgl"
import { Field, Hint, IconButton, NumberInput, Section, Select, Toggle } from "@/shared/ui"
import type { InspectorViewModel } from "../model/use-inspector"
import s from "./inspector.module.css"

const ACTIONS: { value: Action["type"]; label: string }[] = [
  { value: "navigate", label: "Go to screen" },
  { value: "set", label: "Set variable" },
  { value: "increment", label: "Step variable" },
  { value: "toggle", label: "Toggle variable" },
  { value: "play", label: "Play animation" },
]

export function InteractTab({ vm }: { vm: InspectorViewModel }) {
  const node = vm.node!
  const { screens, variables, animations } = vm.project
  const intVars = variables.filter(v => v.type === "int").map(v => ({ value: v.id, label: v.name }))

  const blank = (type: Action["type"]): Action => {
    const variable = intVars[0]?.value ?? ""
    switch (type) {
      case "navigate":
        return { type, screen: screens.find(s => s.id !== node.id)?.id ?? "", anim: "LV_SCREEN_LOAD_ANIM_MOVE_LEFT", duration: 300, delay: 0 }
      case "set":
        return { type, variable, value: 1 }
      case "increment":
        return { type, variable, step: 1 }
      case "toggle":
        return { type, variable }
      case "play":
        return { type, animation: animations[0]?.id ?? "", reverse: false, delay: 0 }
    }
  }

  const add = () => {
    const ev: Interaction = { id: newId(), trigger: node.widget === "screen" ? "LV_EVENT_SCREEN_LOADED" : "LV_EVENT_CLICKED", action: blank(screens.length > 1 ? "navigate" : "set") }
    vm.set(n => void n.events.push(ev))
  }

  return (
    <Section
      title='Interactions'
      collapsible={false}
      actions={
        <IconButton label='Add interaction' onClick={add}>
          <Plus />
        </IconButton>
      }
    >
      {node.events.length === 0 && <Hint>Like Figma's prototype links, but real: each one becomes an LVGL event handler in the export. Try them with Play.</Hint>}
      {node.events.map((ev, i) => {
        const set = (recipe: (e: Interaction) => void) => vm.set(n => recipe(n.events[i]))
        const a = ev.action
        return (
          <div key={ev.id} className={s.card}>
            <div className={s.cardHead}>
              <Select value={ev.trigger} options={EVENTS} onChange={t => set(e => void (e.trigger = t))} />
              <IconButton label='Remove interaction' onClick={() => vm.set(n => void n.events.splice(i, 1))}>
                <Minus />
              </IconButton>
            </div>
            <Field label='Then'>
              <Select value={a.type} options={ACTIONS} onChange={t => set(e => void (e.action = blank(t as Action["type"])))} />
            </Field>
            {a.type === "navigate" && (
              <>
                <Field label='Screen'>
                  <Select value={a.screen} options={screens.filter(s => s.id !== node.id).map(s => ({ value: s.id, label: s.name }))} onChange={v => set(e => void ((e.action as typeof a).screen = v))} placeholder='Choose…' />
                </Field>
                <Field label='Transition'>
                  <Select value={a.anim} options={SCREEN_LOAD_ANIM} onChange={v => set(e => void ((e.action as typeof a).anim = v))} />
                </Field>
                <Field label='Duration'>
                  <NumberInput value={a.duration} min={0} step={10} unit='ms' onChange={v => set(e => void ((e.action as typeof a).duration = v))} />
                </Field>
              </>
            )}
            {(a.type === "set" || a.type === "increment" || a.type === "toggle") && (
              <Field label='Variable'>
                <Select value={a.variable} options={intVars} onChange={v => set(e => void ((e.action as typeof a).variable = v))} placeholder='Choose…' />
              </Field>
            )}
            {a.type === "set" && (
              <Field label='To'>
                <NumberInput value={a.value} onChange={v => set(e => void ((e.action as typeof a).value = v))} />
              </Field>
            )}
            {a.type === "increment" && (
              <Field label='By'>
                <NumberInput value={a.step} onChange={v => set(e => void ((e.action as typeof a).step = v))} />
              </Field>
            )}
            {a.type === "play" && (
              <>
                <Field label='Animation'>
                  <Select value={a.animation} options={animations.map(x => ({ value: x.id, label: x.name }))} onChange={v => set(e => void ((e.action as typeof a).animation = v))} placeholder='Choose…' />
                </Field>
                <Field label='Backwards'>
                  <Toggle checked={a.reverse} onChange={v => set(e => void ((e.action as typeof a).reverse = v))} />
                </Field>
              </>
            )}
          </div>
        )
      })}
    </Section>
  )
}
