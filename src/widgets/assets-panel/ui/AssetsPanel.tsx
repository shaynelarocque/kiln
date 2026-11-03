import { Film, ImagePlus, Minus, Type } from "lucide-react"
import { useEffect, useState } from "react"
import { formatBytes } from "@/entities/board"
import type { ImageFormat, Sprite } from "@/entities/project"
import { Button, Field, Hint, IconButton, NumberInput, Section, Select, Toggle } from "@/shared/ui"
import { useAssets } from "../model/use-assets"
import s from "./assets-panel.module.css"

const FORMATS = [
  { value: "RGB565", label: "RGB565 (2 B/px)" },
  { value: "RGB565A8", label: "RGB565 + alpha (3 B/px)" },
  { value: "ARGB8888", label: "ARGB8888 (4 B/px)" },
]

const uses = (n: number) => `${n} ${n === 1 ? "use" : "uses"}`

export function AssetsPanel() {
  const vm = useAssets()
  return (
    <div
      className={`${s.panel} ${vm.over ? s.over : ""}`}
      onDragOver={vm.dragOver}
      onDragLeave={vm.dragLeave}
      onDrop={vm.drop}
    >
      <Section title='Images' collapsible={false}>
        <Button icon={<ImagePlus />} onClick={vm.pick}>
          Import images…
        </Button>
        <Hint>
          Or drop them here. They're scaled to fit the display and converted to LVGL's pixel
          formats, ready to compile into flash.
        </Hint>
      </Section>
      {vm.assets.map(a => (
        <section key={a.id} className={s.card}>
          <div className={s.thumb}>
            <img src={a.png} alt='' />
          </div>
          <div className={s.meta}>
            <code>{a.name}</code>
            <small>
              {a.width}×{a.height} · {formatBytes(vm.flashBytes(a))} flash · {uses(vm.usesOf(a))}
            </small>
          </div>
          <IconButton label='Delete image' onClick={() => vm.remove(a.id)}>
            <Minus />
          </IconButton>
          <div className={s.controls}>
            <Field label='Format'>
              <Select
                value={a.format}
                options={FORMATS}
                onChange={f => vm.setFormat(a.id, f as ImageFormat)}
              />
            </Field>
            {a.format !== "ARGB8888" && (
              <Field label='Bayer dither'>
                <Toggle checked={a.dither} onChange={d => vm.setDither(a.id, d)} />
              </Field>
            )}
            {vm.imageTarget && (
              <Button onClick={() => vm.useIn(a.id, vm.imageTarget!.id)}>
                Use in {vm.imageTarget.name}
              </Button>
            )}
          </div>
        </section>
      ))}
      <Section title='Sprites' collapsible={false}>
        <Button icon={<Film />} onClick={vm.pickAnimation}>
          Import animation…
        </Button>
        <Hint>
          A GIF, a strip of square frames, or several numbered images. Every frame becomes an LVGL
          image, and the export packs them into a frame array for lv_animimg. Drop GIFs here too.
        </Hint>
      </Section>
      {vm.sprites.map(sp => (
        <section key={sp.id} className={s.card}>
          <div className={s.thumb}>
            <SpritePreview sprite={sp} />
          </div>
          <div className={s.meta}>
            <code>{sp.name}</code>
            <small>
              {sp.frames.length} frames · {sp.width}×{sp.height} · {formatBytes(vm.spriteBytes(sp))}{" "}
              flash · {uses(vm.spriteUses(sp))}
            </small>
          </div>
          <IconButton label='Delete sprite' onClick={() => vm.removeSprite(sp.id)}>
            <Minus />
          </IconButton>
          <div className={s.controls}>
            <Field label='Each frame'>
              <NumberInput
                value={sp.frameMs}
                min={10}
                max={5000}
                step={10}
                unit='ms'
                prefix=''
                onChange={(v, phase) => vm.setFrameMs(sp.id, v, phase)}
              />
            </Field>
            <Field label='Format'>
              <Select
                value={sp.format}
                options={FORMATS}
                onChange={f => vm.setSpriteFormat(sp.id, f as ImageFormat)}
              />
            </Field>
            {sp.format !== "ARGB8888" && (
              <Field label='Bayer dither'>
                <Toggle checked={sp.dither} onChange={d => vm.setSpriteDither(sp.id, d)} />
              </Field>
            )}
            {vm.spriteTarget ? (
              <Button onClick={() => vm.useSprite(sp.id, vm.spriteTarget!.id)}>
                Use in {vm.spriteTarget.name}
              </Button>
            ) : (
              <Button onClick={() => vm.placeSprite(sp.id)}>Add to screen</Button>
            )}
          </div>
        </section>
      ))}
      <Section title='Fonts' collapsible={false}>
        <Button icon={<Type />} onClick={vm.pickFonts}>
          Import fonts…
        </Button>
        <Hint>
          TTF or OTF, also by dropping them here. LVGL's TinyTTF draws them at any size, on the
          canvas and on the board alike; each size in use keeps a small glyph cache in RAM.
        </Hint>
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
                {formatBytes(vm.fontBytes(f))} flash ·{" "}
                {sizes.length ? `used at ${sizes.join(", ")} px` : "not used yet"}
              </small>
            </div>
            <IconButton label='Delete font' onClick={() => vm.removeFont(f.id)}>
              <Minus />
            </IconButton>
            {vm.textTarget && (
              <div className={s.controls}>
                <Button onClick={() => vm.useFont(f.id, vm.textTarget!.id)}>
                  Use on {vm.textTarget.name}
                </Button>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Plays a sprite's frames at its own frame time, like the board will. */
function SpritePreview({ sprite }: { sprite: Sprite }) {
  const [frame, setFrame] = useState(0)
  const count = sprite.frames.length
  useEffect(() => {
    const timer = setInterval(() => setFrame(n => (n + 1) % count), Math.max(20, sprite.frameMs))
    return () => clearInterval(timer)
  }, [count, sprite.frameMs])
  return <img src={sprite.frames[frame % count]?.png} alt='' />
}
