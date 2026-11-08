import { useState } from "react"
import { editorApi } from "@/entities/editor"
import { forgetHardware, savedHardware } from "@/features/project-file"
import { useSettings, type OutputPlace, type Theme } from "@/shared/config"
import { inTauri } from "@/shared/lib/tauri"
import { Button, Dialog, Hint, Toggle } from "@/shared/ui"
import s from "./settings.module.css"

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

const OUTPUTS: { value: OutputPlace; label: string }[] = [
  { value: "panel", label: "Panel under the canvas" },
  { value: "window", label: "Its own window" },
]

/** Kiln's preferences (⌘,): this person's, kept on this machine, not in the project. */
export function SettingsDialog() {
  const settings = useSettings()
  const [hardware, setHardware] = useState(savedHardware)
  const close = () => editorApi.getState().set({ dialog: null })
  return (
    <Dialog
      title='Settings'
      onClose={close}
      footer={
        <Button variant='primary' onClick={close}>
          Done
        </Button>
      }
    >
      <div className={s.list}>
        <Row title='Theme' note='System follows macOS between light and dark.'>
          <Segmented
            value={settings.theme}
            options={THEMES}
            onChange={theme => settings.update({ theme })}
          />
        </Row>

        <Row
          title='Pixel grid'
          note="Lines between display pixels at 600% zoom and closer. ⇧' toggles it."
        >
          <Toggle
            label='Pixel grid'
            checked={settings.pixelGrid}
            onChange={pixelGrid => settings.update({ pixelGrid })}
          />
        </Row>

        <Row
          title='Build and flash output'
          note={
            inTauri()
              ? "Builds run in the background either way, so you can keep editing while one flashes."
              : "Building and flashing need the desktop app."
          }
        >
          <Segmented
            value={settings.output}
            options={OUTPUTS}
            onChange={output => settings.update({ output })}
          />
        </Row>

        <Row
          title='Screen sizes'
          note='Experimental. One UI for several displays, each with its own board, like CSS breakpoints. Off hides the size bar for projects without sizes.'
        >
          <Toggle
            label='Screen sizes'
            checked={settings.sizes}
            onChange={sizes => settings.update({ sizes })}
          />
        </Row>

        <Row
          title='New projects'
          note={
            hardware
              ? "New projects and samples start on the board you last set up, so wiring, SPI clock and colour fixes carry over."
              : "Set up a board once and new projects and samples will start on it."
          }
        >
          {hardware ? (
            <span className={s.hardware}>
              <span>
                <strong>{hardware.board}</strong>
                <small>
                  {hardware.display.driver.toUpperCase()} {hardware.display.width}×
                  {hardware.display.height} · SPI {hardware.display.spiMHz} MHz
                </small>
              </span>
              <Button
                onClick={() => {
                  forgetHardware()
                  setHardware(null)
                }}
              >
                Forget
              </Button>
            </span>
          ) : (
            <Hint>No board remembered yet.</Hint>
          )}
        </Row>
      </div>
    </Dialog>
  )
}

function Row({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section className={s.row}>
      <div>
        <h3>{title}</h3>
        <p>{note}</p>
      </div>
      <div className={s.control}>{children}</div>
    </section>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <span className={s.segmented} role='radiogroup'>
      {options.map(o => (
        <button
          key={o.value}
          role='radio'
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}
