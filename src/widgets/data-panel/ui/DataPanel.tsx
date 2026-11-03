import { Activity, Cpu, Plus, Trash } from "lucide-react"
import type { Sink, Source, Variable } from "@/entities/project"
import { Button, Field, Hint, IconButton, NumberInput, Section, Select, TextInput, Toggle } from "@/shared/ui"
import { useData } from "../model/use-data"
import s from "./data.module.css"

const SIMS = [
  { value: "none", label: "Hold value" },
  { value: "sine", label: "Sine wave" },
  { value: "saw", label: "Ramp" },
  { value: "square", label: "On / off" },
  { value: "random", label: "Random walk" },
]

const SOURCES = [
  { value: "", label: "Your code" },
  { value: "analog", label: "Analog pin" },
  { value: "digital", label: "Digital pin" },
  { value: "uptime", label: "Uptime (s)" },
  { value: "heap", label: "Free heap (KB)" },
  { value: "temperature", label: "Chip temperature (°C)" },
  { value: "custom", label: "C expression" },
]

const SINKS = [
  { value: "", label: "Nothing" },
  { value: "digital", label: "Digital pin (on when ≠ 0)" },
  { value: "pwm", label: "PWM pin (min..max → 0..255)" },
]

export function DataPanel() {
  const vm = useData()
  return (
    <div className={s.panel}>
      <Section
        title='Variables'
        collapsible={false}
        actions={
          <IconButton label='Add variable' onClick={vm.add}>
            <Plus />
          </IconButton>
        }
      >
        <Hint>
          Each variable is an LVGL subject. Bind widgets to it, feed it from a pin, or let it drive one. In Play, simulations stand in for the board.
        </Hint>
        {vm.variables.length === 0 && (
          <Button icon={<Plus />} onClick={vm.add}>
            New variable
          </Button>
        )}
      </Section>
      {vm.variables.map(v => (
        <VariableCard key={v.id} v={v} vm={vm} />
      ))}
    </div>
  )
}

function pinOptions(gpios: number[], reserved: Record<number, string>, only?: number[]) {
  return gpios.filter(p => !only || only.includes(p)).map(p => ({ value: String(p), label: `GPIO${p}${reserved[p] ? ` · ${reserved[p]}` : ""}` }))
}

function VariableCard({ v, vm }: { v: Variable; vm: ReturnType<typeof useData> }) {
  const set = (recipe: (v: Variable) => void, phase?: "start" | "move" | "end") => vm.update(v.id, recipe, phase)
  const uses = vm.uses(v.id)
  const problems = vm.problemsFor(v)
  const isInt = v.type === "int"
  const { pins } = vm

  const setSource = (kind: string) =>
    set(x => {
      const every = x.source?.every ?? 500
      const pin = pins.adc[0] ?? 0
      const next: Record<string, Source | null> = {
        "": null,
        analog: { kind: "analog", pin, inMin: 0, inMax: 4095, every },
        digital: { kind: "digital", pin: pins.gpios[0] ?? 0, pull: "up", invert: false, every: 50 },
        uptime: { kind: "uptime", every: 1000 },
        heap: { kind: "heap", every: 1000 },
        temperature: { kind: "temperature", every: 2000 },
        custom: { kind: "custom", expr: "0", every },
      }
      x.source = next[kind]
    })

  const setSink = (kind: string) =>
    set(x => {
      const pin = x.sink?.pin ?? pins.gpios[0] ?? 0
      x.sink = kind === "digital" ? ({ kind, pin, invert: false } as Sink) : kind === "pwm" ? ({ kind, pin } as Sink) : null
    })

  return (
    <section className={s.card}>
      <header>
        <input
          key={v.name}
          className={s.name}
          defaultValue={v.name}
          aria-label='Variable name'
          onBlur={e => {
            const name = e.target.value.trim().replace(/\W+/g, "_")
            if (name && name !== v.name) set(x => void (x.name = name))
          }}
          onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <Select value={v.type} options={[{ value: "int", label: "int" }, { value: "string", label: "text" }]} onChange={t => set(x => void ((x.type = t as Variable["type"]), (x.initial = t === "int" ? 0 : "")))} />
        <IconButton label='Delete variable' onClick={() => vm.remove(v.id)}>
          <Trash />
        </IconButton>
      </header>

      {isInt ? (
        <>
          <div className={s.slider}>
            <input type='range' min={v.min} max={v.max} value={Number(v.initial)} onChange={e => set(x => void (x.initial = Number(e.target.value)), "move")} onPointerDown={() => set(() => {}, "start")} onPointerUp={() => set(() => {}, "end")} aria-label='Value' />
            <NumberInput value={Number(v.initial)} min={Math.min(v.min, v.max)} max={Math.max(v.min, v.max)} onChange={(n, phase) => set(x => void (x.initial = n), phase)} />
          </div>
          <div className={s.pair}>
            <NumberInput prefix='Min' value={v.min} onChange={(n, phase) => set(x => void (x.min = n), phase)} />
            <NumberInput prefix='Max' value={v.max} onChange={(n, phase) => set(x => void (x.max = n), phase)} />
          </div>
          <Field label={<span className={s.label}><Activity /> In Play</span>}>
            <Select value={v.sim.kind} options={SIMS} onChange={k => set(x => void (x.sim.kind = k as Variable["sim"]["kind"]))} />
          </Field>
          {v.sim.kind !== "none" && (
            <Field label='Period'>
              <NumberInput value={v.sim.period} min={100} step={100} unit='ms' onChange={(n, phase) => set(x => void (x.sim.period = n), phase)} />
            </Field>
          )}
        </>
      ) : (
        <Field label='Value'>
          <TextInput value={String(v.initial)} onChange={t => set(x => void (x.initial = t))} />
        </Field>
      )}

      {isInt && (
        <div className={s.hw}>
          <Field label={<span className={s.label}><Cpu /> From</span>}>
            <Select value={v.source?.kind ?? ""} options={SOURCES} onChange={setSource} />
          </Field>
          {v.source?.kind === "analog" && (
            <>
              <Field label='Pin'>
                <Select value={String(v.source.pin)} options={pinOptions(pins.gpios, pins.reserved, [...pins.adc, ...pins.adc2])} onChange={p => set(x => void ((x.source as { pin: number }).pin = Number(p)))} />
              </Field>
              <Field label='Raw range'>
                <span className={s.pair}>
                  <NumberInput value={v.source.inMin} onChange={n => set(x => void ((x.source as { inMin: number }).inMin = n))} />
                  <NumberInput value={v.source.inMax} onChange={n => set(x => void ((x.source as { inMax: number }).inMax = n))} />
                </span>
              </Field>
              <Hint>Mapped onto {v.min}..{v.max}. The ESP32 ADC reads 0..4095.</Hint>
            </>
          )}
          {v.source?.kind === "digital" && (
            <>
              <Field label='Pin'>
                <Select value={String(v.source.pin)} options={pinOptions(pins.gpios, pins.reserved)} onChange={p => set(x => void ((x.source as { pin: number }).pin = Number(p)))} />
              </Field>
              <Field label='Pull'>
                <Select value={v.source.pull} options={[{ value: "up", label: "Pull-up" }, { value: "down", label: "Pull-down" }, { value: "none", label: "None" }]} onChange={p => set(x => void ((x.source as { pull: string }).pull = p))} />
              </Field>
              <Field label='Invert'>
                <Toggle checked={v.source.invert} onChange={b => set(x => void ((x.source as { invert: boolean }).invert = b))} />
              </Field>
            </>
          )}
          {v.source?.kind === "custom" && (
            <Field label='Expression' wide>
              <TextInput value={v.source.expr} onChange={t => set(x => void ((x.source as { expr: string }).expr = t))} mono placeholder='e.g. my_sensor_read()' />
            </Field>
          )}
          {v.source && (
            <Field label='Read every'>
              <NumberInput value={v.source.every} min={5} step={10} unit='ms' onChange={n => set(x => void (x.source!.every = n))} />
            </Field>
          )}

          <Field label={<span className={s.label}><Cpu /> Drives</span>}>
            <Select value={v.sink?.kind ?? ""} options={SINKS} onChange={setSink} />
          </Field>
          {v.sink && (
            <Field label='Pin'>
              <Select value={String(v.sink.pin)} options={pinOptions(pins.gpios.filter(p => !pins.inputOnly.includes(p)), pins.reserved)} onChange={p => set(x => void (x.sink!.pin = Number(p)))} />
              {v.sink.kind === "digital" && <Toggle checked={v.sink.invert} onChange={b => set(x => void ((x.sink as { invert: boolean }).invert = b))} label='Invert' />}
            </Field>
          )}
        </div>
      )}

      {problems.map((p, i) => (
        <Hint key={i} tone={p.level === "error" ? "error" : "warn"}>
          {p.message}
        </Hint>
      ))}
      <p className={s.uses}>{uses.length ? `Bound to ${uses.join(", ")}` : "Not bound yet: select a widget, then Bind."}</p>
    </section>
  )
}
