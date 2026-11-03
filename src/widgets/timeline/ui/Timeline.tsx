import { CirclePlay, Minus, Plus, Trash, X } from "lucide-react"
import { useRef } from "react"
import type { Track } from "@/entities/project"
import { ANIM_PROPS, EASINGS, type Easing } from "@/shared/lvgl"
import {
  ColorInput,
  Field,
  Hint,
  IconButton,
  NumberInput,
  Select,
  TextInput,
  Toggle,
  DISPLAY,
} from "@/shared/ui"
import { useTimeline } from "../model/use-timeline"
import s from "./timeline.module.css"

export function Timeline() {
  const vm = useTimeline()
  const ruler = useRef<HTMLDivElement>(null)
  const pxPerMs = () => (ruler.current?.clientWidth ?? 600) / vm.duration
  const ticks = Array.from({ length: Math.floor(vm.duration / 100) + 1 }, (_, i) => i * 100)

  const dragKey = (track: Track, index: number, e: React.PointerEvent) => {
    e.stopPropagation()
    vm.pick(track.id, index)
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const t0 = track.keyframes[index].t
    let phase: "start" | "move" = "start"
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) < 2 && phase === "start") return
      vm.moveKey(track.id, index, t0 + (ev.clientX - x0) / pxPerMs(), phase)
      phase = "move"
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      if (phase === "move") vm.moveKey(track.id, index, t0 + (ev.clientX - x0) / pxPerMs(), "end")
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
  }

  const prop = vm.pickedTrack && ANIM_PROPS.find(p => p.value === vm.pickedTrack!.prop)

  return (
    <section className={s.timeline}>
      <header className={s.head}>
        <strong>Animation</strong>
        {vm.anim ? (
          <Select
            value={vm.anim.id}
            options={vm.project.animations.map(a => ({ value: a.id, label: a.name }))}
            onChange={vm.open}
          />
        ) : (
          <span className={s.dim}>none yet</span>
        )}
        <IconButton label='New animation' onClick={vm.create}>
          <Plus />
        </IconButton>
        {vm.anim && (
          <>
            <input
              key={vm.anim.name}
              className={s.name}
              defaultValue={vm.anim.name}
              aria-label='Animation name'
              onBlur={e =>
                e.target.value.trim() && vm.update(a => void (a.name = e.target.value.trim()))
              }
            />
            <label className={s.opt}>
              <Toggle
                checked={vm.anim.autoplay}
                onChange={v => vm.update(a => void (a.autoplay = v))}
              />{" "}
              on screen load
            </label>
            <label className={s.opt}>
              <Toggle
                checked={vm.anim.alternate}
                onChange={v => vm.update(a => void (a.alternate = v))}
              />{" "}
              alternate
            </label>
            <label className={s.opt}>
              <Toggle
                checked={vm.anim.repeat < 0}
                onChange={v => vm.update(a => void (a.repeat = v ? -1 : 0))}
              />{" "}
              loop
            </label>
            {vm.anim.repeat >= 0 && (
              <span className={s.num}>
                <NumberInput
                  prefix='×'
                  value={vm.anim.repeat + 1}
                  min={1}
                  max={100}
                  onChange={v => vm.update(a => void (a.repeat = v - 1))}
                  title='Plays'
                />
              </span>
            )}
            <span className={s.num}>
              <NumberInput
                prefix='Delay'
                value={vm.anim.delay}
                min={0}
                step={50}
                unit='ms'
                onChange={v => vm.update(a => void (a.delay = v))}
              />
            </span>
            <IconButton label='Preview in Play' onClick={vm.preview}>
              <CirclePlay />
            </IconButton>
            <IconButton label='Delete animation' onClick={vm.remove}>
              <Trash />
            </IconButton>
          </>
        )}
        <span className={s.spacer} />
        <IconButton label='Close timeline' onClick={vm.close}>
          <X />
        </IconButton>
      </header>

      {!vm.anim ? (
        <div className={s.empty}>
          <Hint>
            Keyframe timelines, like CSS @keyframes: pick a widget, add a track, drag keys along the
            ruler. They export as lv_anim_timeline_t.
          </Hint>
        </div>
      ) : (
        <div className={s.body}>
          <div className={s.tracks}>
            <div className={s.trackHead}>
              {vm.target ? (
                <Select
                  value=''
                  placeholder={`+ Track for ${vm.target.name}`}
                  options={vm
                    .props(vm.target.widget)
                    .map(p => ({ value: p.value, label: p.label }))}
                  onChange={v => v && vm.addTrack(v)}
                />
              ) : (
                <span className={s.dim}>Select a widget to animate it</span>
              )}
            </div>
            {vm.anim.tracks.map(track => (
              <div key={track.id} className={s.trackName}>
                <span>
                  <strong>{vm.nodeName(track.node)}</strong>{" "}
                  {ANIM_PROPS.find(p => p.value === track.prop)?.label}
                </span>
                <IconButton label='Remove track' onClick={() => vm.removeTrack(track.id)}>
                  <Minus />
                </IconButton>
              </div>
            ))}
          </div>
          <div className={s.lanes}>
            <div className={s.ruler} ref={ruler}>
              {ticks.map(t => (
                <span
                  key={t}
                  className={t % 500 === 0 ? s.major : ""}
                  style={{ left: `${(t / vm.duration) * 100}%` }}
                >
                  {t % 500 === 0 ? `${t}` : ""}
                </span>
              ))}
            </div>
            {vm.anim.tracks.map(track => {
              const keys = track.keyframes
              const sorted = [...keys].sort((a, b) => a.t - b.t)
              return (
                <div
                  key={track.id}
                  className={s.lane}
                  onDoubleClick={e => {
                    const box = e.currentTarget.getBoundingClientRect()
                    vm.addKey(track.id, ((e.clientX - box.left) / box.width) * vm.duration)
                  }}
                  title='Double-click to add a keyframe'
                >
                  {sorted.length > 1 && (
                    <span
                      className={s.span}
                      style={{
                        left: `${(sorted[0].t / vm.duration) * 100}%`,
                        width: `${((sorted.at(-1)!.t - sorted[0].t) / vm.duration) * 100}%`,
                      }}
                    />
                  )}
                  {keys.map((k, i) => (
                    <button
                      key={i}
                      className={`${s.key} ${vm.picked?.track === track.id && vm.picked.index === i ? s.keyOn : ""}`}
                      style={{ left: `${(k.t / vm.duration) * 100}%` }}
                      onPointerDown={e => dragKey(track, i, e)}
                      title={`${k.t} ms`}
                      aria-label={`Keyframe at ${k.t} ms`}
                    />
                  ))}
                </div>
              )
            })}
          </div>
          <div className={s.keyEditor}>
            {vm.pickedKey && prop ? (
              <>
                <Field label='Time'>
                  <NumberInput
                    value={vm.pickedKey.t}
                    min={0}
                    step={10}
                    unit='ms'
                    onChange={(t, phase) => vm.setKey({ t }, phase)}
                  />
                </Field>
                <Field label={prop.label}>
                  {prop.unit === "color" ? (
                    <ColorInput
                      value={String(vm.pickedKey.value)}
                      onChange={(value, phase) => vm.setKey({ value }, phase)}
                    />
                  ) : (
                    <NumberInput
                      value={Number(vm.pickedKey.value)}
                      scale={DISPLAY[prop.unit]?.scale ?? 1}
                      unit={DISPLAY[prop.unit]?.unit}
                      onChange={(value, phase) => vm.setKey({ value }, phase)}
                      prefix=''
                    />
                  )}
                </Field>
                <Field label='Easing out'>
                  <Select
                    value={vm.pickedKey.easing.startsWith("cubic") ? "custom" : vm.pickedKey.easing}
                    options={[...EASINGS, { value: "custom", label: "cubic-bezier()" }]}
                    onChange={v =>
                      vm.setKey({
                        easing: (v === "custom"
                          ? "cubic-bezier(0.34, 1.56, 0.64, 1)"
                          : v) as Easing,
                      })
                    }
                  />
                </Field>
                {vm.pickedKey.easing.startsWith("cubic") && (
                  <TextInput
                    value={vm.pickedKey.easing}
                    onChange={v => vm.setKey({ easing: v as Easing })}
                    mono
                  />
                )}
                <IconButton label='Delete keyframe' onClick={vm.removeKey}>
                  <Trash />
                </IconButton>
              </>
            ) : (
              <Hint>
                Pick a keyframe to edit its value and the easing to the next one. Double-click a
                lane to add one.
              </Hint>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
