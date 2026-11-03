import { ImagePlus, Minus, Type } from "lucide-react"
import { formatBytes } from "@/entities/board"
import type { ImageFormat } from "@/entities/project"
import { Button, Field, Hint, IconButton, Section, Select, Toggle } from "@/shared/ui"
import { useAssets } from "../model/use-assets"
import s from "./assets-panel.module.css"

const FORMATS = [
  { value: "RGB565", label: "RGB565 (2 B/px)" },
  { value: "RGB565A8", label: "RGB565 + alpha (3 B/px)" },
  { value: "ARGB8888", label: "ARGB8888 (4 B/px)" },
]

export function AssetsPanel() {
  const vm = useAssets()
  return (
    <div className={`${s.panel} ${vm.over ? s.over : ""}`} onDragOver={vm.dragOver} onDragLeave={vm.dragLeave} onDrop={vm.drop}>
      <Section title='Images' collapsible={false}>
        <Button icon={<ImagePlus />} onClick={vm.pick}>
          Import images…
        </Button>
        <Hint>Or drop them here. They're scaled to fit the display and converted to LVGL's pixel formats, ready to compile into flash.</Hint>
      </Section>
      {vm.assets.map(a => (
        <section key={a.id} className={s.card}>
          <div className={s.thumb}>
            <img src={a.png} alt='' />
          </div>
          <div className={s.meta}>
            <code>{a.name}</code>
            <small>
              {a.width}×{a.height} · {formatBytes(vm.flashBytes(a))} flash · {vm.usesOf(a)} uses
            </small>
          </div>
          <IconButton label='Delete image' onClick={() => vm.remove(a.id)}>
            <Minus />
          </IconButton>
          <div className={s.controls}>
            <Field label='Format'>
              <Select value={a.format} options={FORMATS} onChange={f => vm.setFormat(a.id, f as ImageFormat)} />
            </Field>
            {a.format !== "ARGB8888" && (
              <Field label='Bayer dither'>
                <Toggle checked={a.dither} onChange={d => vm.setDither(a.id, d)} />
              </Field>
            )}
            {vm.imageTarget && <Button onClick={() => vm.useIn(a.id, vm.imageTarget!.id)}>Use in {vm.imageTarget.name}</Button>}
          </div>
        </section>
      ))}
      <Section title='Fonts' collapsible={false}>
        <Button icon={<Type />} onClick={vm.pickFonts}>
          Import fonts…
        </Button>
        <Hint>TTF or OTF, also by dropping them here. LVGL's TinyTTF draws them at any size, on the canvas and on the board alike; each size in use keeps a small glyph cache in RAM.</Hint>
      </Section>
      {vm.fonts.map(f => {
        const sizes = vm.fontSizes(f)
        return (
          <section key={f.id} className={s.card}>
            <div className={s.thumb} style={{ fontFamily: vm.fontFamily(f) }} aria-hidden>
              Aa
            </div>
            <div className={s.meta}>
              <code>{f.name}</code>
              <small>
                {formatBytes(vm.fontBytes(f))} flash · {sizes.length ? `used at ${sizes.join(", ")} px` : "not used yet"}
              </small>
            </div>
            <IconButton label='Delete font' onClick={() => vm.removeFont(f.id)}>
              <Minus />
            </IconButton>
            {vm.textTarget && (
              <div className={s.controls}>
                <Button onClick={() => vm.useFont(f.id, vm.textTarget!.id)}>Use on {vm.textTarget.name}</Button>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
