import { Component, Unlink } from "lucide-react"
import type { Node } from "@/entities/project"
import { componentFromSelection, detach, goToMain } from "@/features/components"
import { Button, Field, Hint, Section, Select, TextInput } from "@/shared/ui"
import type { InspectorViewModel } from "../model/use-inspector"
import s from "./inspector.module.css"

const descendants = (n: Node): Node[] => [n, ...n.children.flatMap(descendants)]

export function ComponentSection({ vm }: { vm: InspectorViewModel }) {
  const node = vm.node!
  if (!vm.parent) return null

  if (vm.isMain)
    return (
      <Section title='Main component'>
        <Hint>
          {vm.instanceCount} {vm.instanceCount === 1 ? "instance follows" : "instances follow"}{" "}
          this. Edit it here and they all change.
        </Hint>
      </Section>
    )

  if (!node.component)
    return (
      <Section title='Component' defaultOpen={false}>
        <Hint>
          Reuse this as a component: it moves to the Components screen and an instance takes its
          place.
        </Hint>
        <Button icon={<Component />} onClick={componentFromSelection}>
          Make component
        </Button>
      </Section>
    )

  if (!vm.main)
    return (
      <Section title='Component'>
        <Hint tone='warn'>Its main component was deleted, so this instance builds nothing.</Hint>
      </Section>
    )

  const texts = descendants(vm.main).filter(n => typeof n.props.text === "string")
  const bound = descendants(vm.main).filter(n => n.bindings.length)
  return (
    <Section
      title={
        <span className={s.instanceTitle}>
          <Component /> Instance of {vm.main.name}
        </span>
      }
    >
      <div className={s.actions}>
        <Button onClick={() => goToMain(node.id)}>Edit main</Button>
        <Button icon={<Unlink />} onClick={() => detach(node.id)}>
          Detach
        </Button>
      </div>
      {texts.map(t => (
        <Field key={t.id} label={t.name}>
          <TextInput
            value={String(node.overrides?.[t.id]?.props?.text ?? t.props.text)}
            onChange={v => vm.overrideProp(t.id, "text", v === t.props.text ? undefined : v)}
          />
        </Field>
      ))}
      {bound.map(b => (
        <Field key={b.id} label={`${b.name} reads`}>
          <Select
            value={node.overrides?.[b.id]?.variable ?? b.bindings[0].variable}
            options={vm.project.variables.map(v => ({ value: v.id, label: v.name }))}
            onChange={v => vm.overrideVariable(b.id, v === b.bindings[0].variable ? undefined : v)}
          />
        </Field>
      ))}
      {texts.length + bound.length > 0 && <Hint>Overrides apply to this instance only.</Hint>}
    </Section>
  )
}
