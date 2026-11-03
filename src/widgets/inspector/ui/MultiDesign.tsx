import type { Coord } from "@/shared/lvgl"
import { STYLE_PROPS } from "@/shared/lvgl"
import { Hint, NumberInput, Section, StyleProps } from "@/shared/ui"
import type { InspectorViewModel } from "../model/use-inspector"
import { CoordInput, PropField } from "./DesignTab"
import s from "./inspector.module.css"

/** A size field for several layers: theirs if they agree, a blank "Mixed" px field if not. */
function MultiCoord({
  label,
  at,
  onChange,
}: {
  label: string
  at: { value: Coord; mixed: boolean }
  onChange: (v: Coord, phase?: "start" | "move" | "end") => void
}) {
  if (!at.mixed)
    return <CoordInput label={label} value={at.value} onChange={onChange} allowContent />
  return (
    <span className={s.coord}>
      <NumberInput value={null} prefix={label} placeholder='Mixed' onChange={onChange} />
      <span className={s.unit}>px</span>
    </span>
  )
}

/** Design for several selected layers: their size, shared widget props, and shared style. */
export function MultiDesign({ vm }: { vm: InspectorViewModel }) {
  const m = vm.multi!
  // text is each layer's own content; everything else can be set across them
  const props = m.def?.props.filter(p => p.type !== "text" && p.type !== "lines") ?? []
  const label = (name: string) => STYLE_PROPS.find(p => p.name === name)?.label ?? name
  return (
    <>
      <Section title='Size'>
        <div className={s.pair}>
          <MultiCoord label='W' at={m.w} onChange={(v, phase) => m.setLayout("w", v, phase)} />
          <MultiCoord label='H' at={m.h} onChange={(v, phase) => m.setLayout("h", v, phase)} />
        </div>
      </Section>
      {props.length > 0 && (
        <Section title={`${m.def!.label} · all ${m.count}`}>
          {props.map(p => {
            const shared = m.prop(p.key)
            return (
              <PropField
                key={p.key}
                prop={p}
                value={shared.value}
                mixed={shared.mixed}
                setProp={m.setProp}
                assets={vm.assets}
                sprites={vm.sprites}
              />
            )
          })}
        </Section>
      )}
      <StyleProps
        props={m.style}
        onChange={m.setStyle}
        tokens={vm.tokens}
        assets={vm.assets}
        fonts={vm.fonts}
        widget={m.widget ?? undefined}
      />
      {m.mixedStyle.length > 0 && (
        <div className={s.note}>
          <Hint>
            Set differently across these layers: {m.mixedStyle.map(label).join(", ")}. Add one above
            to give them all the same value.
          </Hint>
        </div>
      )}
    </>
  )
}
