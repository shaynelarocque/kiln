import { Plus, Search, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import {
  DISPLAY_DRIVERS,
  DISPLAY_PRESETS,
  TOUCH_DRIVERS,
  TOUCH_TURNS,
  formatBytes,
} from "@/entities/board"
import type { ButtonKey, DisplayConfig, TouchConfig, TouchDriver } from "@/entities/project"
import { BUTTON_KEYS } from "@/shared/lvgl"
import {
  Button,
  Dialog,
  Field,
  Hint,
  IconButton,
  NumberInput,
  Select,
  TextInput,
  Toggle,
} from "@/shared/ui"
import { KITS } from "../model/kits"
import { useBoardDialog } from "../model/use-board-dialog"
import s from "./board-dialog.module.css"

const PIN_LABELS: { key: keyof DisplayConfig["pins"]; label: string }[] = [
  { key: "sck", label: "SCK (clock)" },
  { key: "mosi", label: "MOSI (data)" },
  { key: "cs", label: "CS" },
  { key: "dc", label: "DC" },
  { key: "rst", label: "Reset" },
  { key: "bl", label: "Backlight" },
]

type TouchPin = { key: keyof TouchConfig["pins"]; label: string }
const I2C_TOUCH_PINS: TouchPin[] = [
  { key: "sda", label: "Touch SDA" },
  { key: "scl", label: "Touch SCL" },
  { key: "int", label: "Touch INT" },
  { key: "rst", label: "Touch reset" },
]
const SPI_TOUCH_PINS: TouchPin[] = [
  { key: "cs", label: "Touch CS" },
  { key: "miso", label: "Touch MISO" },
  { key: "sck", label: "Touch SCK" },
  { key: "mosi", label: "Touch MOSI" },
  { key: "int", label: "Touch IRQ" },
]

type SectionId = "board" | "display" | "touch" | "buttons" | "pins" | "memory" | "platformio"

type VM = ReturnType<typeof useBoardDialog>

export function BoardDialog() {
  const vm = useBoardDialog()
  const [section, setSection] = useState<SectionId>("display")
  const d = vm.display
  const pinOptions = [
    { value: "-1", label: "Not connected" },
    ...vm.pins.gpios.map(p => ({
      value: String(p),
      label: `GPIO${p}${vm.pins.reserved[p] ? ` · ${vm.pins.reserved[p]}` : ""}`,
    })),
  ]
  const errors = vm.problems.filter(p => p.level === "error").length
  const pct = (used: number, total: number) => `${Math.round((used / total) * 100)}%`
  const nav: { id: SectionId; title: string; summary: string; tone?: "warn" | "error" | "ok" }[] = [
    { id: "board", title: "Board", summary: vm.board?.name ?? vm.project.target.board },
    {
      id: "display",
      title: "Display",
      summary: `${d.driver.toUpperCase()} ${d.width}×${d.height}${d.round ? " round" : ""} · ${d.spiMHz} MHz`,
    },
    {
      id: "touch",
      title: "Touch",
      summary: d.touch
        ? (TOUCH_DRIVERS.find(t => t.value === d.touch!.driver)?.label.split(" ")[0] ?? "")
        : "None",
    },
    {
      id: "buttons",
      title: "Buttons",
      summary: vm.buttons.length
        ? `${vm.buttons.length} button${vm.buttons.length > 1 ? "s" : ""}`
        : "None",
    },
    {
      id: "pins",
      title: "Pin check",
      summary: vm.problems.length
        ? `${vm.problems.length} to look at`
        : `${vm.claims.length} pins, all fine`,
      tone: errors ? "error" : vm.problems.length ? "warn" : "ok",
    },
    {
      id: "memory",
      title: "Memory",
      summary: `Flash ${pct(vm.budget.flash.used, vm.budget.flash.total)} · RAM ${pct(vm.budget.ram.used, vm.budget.ram.total)}`,
      tone:
        vm.budget.flash.used > vm.budget.flash.total || vm.budget.heapShort ? "warn" : undefined,
    },
    { id: "platformio", title: "PlatformIO", summary: "platformio.ini and the panel config" },
  ]

  return (
    <Dialog
      title={vm.sizeName ? `Board, display and pins · ${vm.sizeName}` : "Board, display and pins"}
      onClose={vm.close}
      wide
      footer={
        <>
          <span className={s.footNote}>
            {vm.sizeName
              ? `These settings belong to the ${vm.sizeName} size; the base size keeps its own.`
              : "New projects and samples start on this setup."}
          </span>
          <Button variant='primary' onClick={vm.close}>
            Done
          </Button>
        </>
      }
    >
      <div className={s.kit}>
        <span>
          <strong>Dev kit</strong>
          <small>A board with its screen built on fills in every section.</small>
        </span>
        <Select
          value={vm.kitIndex >= 0 ? String(vm.kitIndex) : ""}
          placeholder='None: my own parts'
          options={KITS.map((k, i) => ({ value: String(i), label: k.label }))}
          onChange={i => i !== "" && vm.applyKit(KITS[Number(i)])}
        />
      </div>
      <div className={s.layout}>
        <nav className={s.nav} aria-label='Sections'>
          {nav.map(n => (
            <button
              key={n.id}
              aria-current={section === n.id ? "page" : undefined}
              onClick={() => setSection(n.id)}
            >
              <strong>{n.title}</strong>
              <small data-tone={n.tone}>{n.summary}</small>
            </button>
          ))}
        </nav>
        <div className={s.content}>
          {section === "board" && <BoardSection vm={vm} />}
          {section === "display" && <DisplaySection vm={vm} pinOptions={pinOptions} />}
          {section === "touch" && <TouchSection vm={vm} pinOptions={pinOptions} />}
          {section === "buttons" && <ButtonsSection vm={vm} pinOptions={pinOptions} />}
          {section === "pins" && <PinsSection vm={vm} />}
          {section === "memory" && <MemorySection vm={vm} />}
          {section === "platformio" && <PlatformioSection vm={vm} />}
        </div>
      </div>
    </Dialog>
  )
}

/** A titled group of fields inside a section. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={s.group}>
      <h4>{title}</h4>
      {children}
    </div>
  )
}

function Heading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className={s.heading}>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </header>
  )
}

function BoardSection({ vm }: { vm: VM }) {
  return (
    <>
      <Heading title='Board'>
        The PlatformIO board the firmware builds for. It sets the pins you can use and how much
        flash and RAM there is.
      </Heading>
      <label className={s.search}>
        <Search />
        <input
          value={vm.query}
          onChange={e => vm.setQuery(e.target.value)}
          placeholder={`Search ${vm.boards.length} PlatformIO boards`}
        />
      </label>
      <ul className={s.boards}>
        {vm.results.map(b => (
          <li key={b.id}>
            <button
              aria-pressed={b.id === vm.project.target.board}
              onClick={() => vm.selectBoard(b.id)}
            >
              <strong>{b.name}</strong>
              <small>
                {b.mcu} · {Math.round(b.fcpu / 1e6)} MHz · {formatBytes(b.ram)} RAM ·{" "}
                {formatBytes(b.rom)} flash
              </small>
              <code>{b.id}</code>
            </button>
          </li>
        ))}
      </ul>
      <Hint>
        {vm.source === "platformio"
          ? "From your PlatformIO install."
          : "Bundled snapshot of PlatformIO's board definitions; install PlatformIO to see every board."}
        {!vm.query && ` Showing ${vm.mcu} boards; search to see the rest.`}
      </Hint>
    </>
  )
}

type PinOptions = { value: string; label: string }[]

function DisplaySection({ vm, pinOptions }: { vm: VM; pinOptions: PinOptions }) {
  const d = vm.display
  return (
    <>
      <Heading title='Display'>
        Pick the module you have; its controller, size and usual colour fixes come with it.
      </Heading>
      <Field label='Module'>
        <Select
          value={vm.presetIndex >= 0 ? String(vm.presetIndex) : ""}
          placeholder='Custom'
          options={DISPLAY_PRESETS.map((p, i) => ({ value: String(i), label: p.label }))}
          onChange={i => i !== "" && vm.applyPreset(DISPLAY_PRESETS[Number(i)])}
        />
      </Field>
      <div className={s.columns}>
        <Group title='Panel'>
          <Field label='Controller'>
            <Select
              value={d.driver}
              options={DISPLAY_DRIVERS.map(x => ({ value: x.value, label: x.label }))}
              onChange={v => vm.setDisplay({ driver: v as DisplayConfig["driver"] })}
            />
          </Field>
          <Field label='Size'>
            <NumberInput
              prefix='W'
              value={d.width}
              min={16}
              max={1024}
              onChange={(v, phase) => vm.setDisplay({ width: v }, phase)}
            />
            <NumberInput
              prefix='H'
              value={d.height}
              min={16}
              max={1024}
              onChange={(v, phase) => vm.setDisplay({ height: v }, phase)}
            />
          </Field>
          <Field label='Rotation'>
            <Select
              value={String(d.rotation)}
              options={[0, 1, 2, 3].map(r => ({ value: String(r), label: `${r * 90}°` }))}
              onChange={v => vm.setDisplay({ rotation: Number(v) })}
            />
          </Field>
          <Field label='Round'>
            <Toggle checked={d.round} onChange={round => vm.setDisplay({ round })} />
          </Field>
        </Group>
        <Group title='Colour and position'>
          <Field label='Invert colours'>
            <Toggle checked={d.invert} onChange={invert => vm.setDisplay({ invert })} />
          </Field>
          <Field label='Swap red/blue'>
            <Toggle checked={d.bgr} onChange={bgr => vm.setDisplay({ bgr })} />
          </Field>
          <Field label='Offset'>
            <NumberInput
              prefix='X'
              value={d.offsetX}
              onChange={offsetX => vm.setDisplay({ offsetX })}
            />
            <NumberInput
              prefix='Y'
              value={d.offsetY}
              onChange={offsetY => vm.setDisplay({ offsetY })}
            />
          </Field>
          <Hint>
            Wrong colours or a shifted picture on the real panel? These are the usual fixes.
          </Hint>
        </Group>
        <Group title='Wiring'>
          {PIN_LABELS.map(p => (
            <Field key={p.key} label={p.label}>
              <Select
                value={String(d.pins[p.key])}
                options={pinOptions}
                onChange={v => vm.setPin(p.key, Number(v))}
              />
            </Field>
          ))}
        </Group>
        <Group title='Bus and buffers'>
          <Field label='SPI clock'>
            <NumberInput
              value={d.spiMHz}
              min={1}
              max={80}
              unit='MHz'
              onChange={spiMHz => vm.setDisplay({ spiMHz })}
            />
          </Field>
          <Field label='Buffer rows'>
            <NumberInput
              value={d.bufferRows}
              min={4}
              max={d.height}
              unit={`× 2 = ${formatBytes(2 * d.width * d.bufferRows * 2)}`}
              onChange={bufferRows => vm.setDisplay({ bufferRows })}
            />
          </Field>
          <Hint>
            80 MHz is as fast as the ESP32's SPI bus goes, whatever the CPU clock. Garbled or
            flickering picture? Long wires and breadboards often need a slower clock (20 to 40 MHz).
          </Hint>
        </Group>
      </div>
    </>
  )
}

function TouchSection({ vm, pinOptions }: { vm: VM; pinOptions: PinOptions }) {
  const t = vm.display.touch
  return (
    <>
      <Heading title='Touch'>
        A touch panel over the display turns taps into LVGL pointer events, on the board and in
        Play.
      </Heading>
      <Field label='Controller'>
        <Select
          value={t?.driver ?? ""}
          options={[
            { value: "", label: "None" },
            ...TOUCH_DRIVERS.map(x => ({ value: x.value, label: x.label })),
          ]}
          onChange={v => vm.setTouchDriver(v ? (v as TouchDriver) : null)}
        />
      </Field>
      {t && (
        <div className={s.columns}>
          <Group title='Calibration'>
            <Field label='Raw X'>
              <NumberInput
                prefix='Min'
                value={t.xMin}
                min={0}
                max={65535}
                onChange={(xMin, phase) => vm.setTouch({ xMin }, phase)}
              />
              <NumberInput
                prefix='Max'
                value={t.xMax}
                min={0}
                max={65535}
                onChange={(xMax, phase) => vm.setTouch({ xMax }, phase)}
              />
            </Field>
            <Field label='Raw Y'>
              <NumberInput
                prefix='Min'
                value={t.yMin}
                min={0}
                max={65535}
                onChange={(yMin, phase) => vm.setTouch({ yMin }, phase)}
              />
              <NumberInput
                prefix='Max'
                value={t.yMax}
                min={0}
                max={65535}
                onChange={(yMax, phase) => vm.setTouch({ yMax }, phase)}
              />
            </Field>
            <Field label='Orientation'>
              <Select
                value={String(t.rotation)}
                options={TOUCH_TURNS.map((label, i) => ({ value: String(i), label }))}
                onChange={v => vm.setTouch({ rotation: Number(v) })}
              />
            </Field>
            <Hint>
              {t.driver === "xpt2046"
                ? "Resistive panels vary: if taps land off target, widen or narrow the raw range, or turn the touch layer."
                : "Capacitive chips report pixels. If taps land mirrored or turned, change the orientation."}
            </Hint>
          </Group>
          <Group title='Wiring'>
            {(t.driver === "xpt2046" ? SPI_TOUCH_PINS : I2C_TOUCH_PINS).map(p => (
              <Field key={p.key} label={p.label}>
                <Select
                  value={String(t.pins[p.key])}
                  options={pinOptions}
                  onChange={v => vm.setTouchPin(p.key, Number(v))}
                />
              </Field>
            ))}
          </Group>
        </div>
      )}
    </>
  )
}

function ButtonsSection({ vm, pinOptions }: { vm: VM; pinOptions: PinOptions }) {
  return (
    <>
      <Heading title='Buttons'>
        Push buttons work the screen like a keypad: “Next widget” moves the focus, “Press” clicks
        what has it. In Play, your keyboard stands in for them.
      </Heading>
      <div className={s.buttons}>
        {vm.buttons.map(b => (
          <div key={b.id} className={s.button}>
            <div className={s.buttonHead}>
              <TextInput value={b.name} onChange={name => vm.setButton(b.id, { name })} />
              <IconButton label={`Remove ${b.name}`} onClick={() => vm.removeButton(b.id)}>
                <Trash2 />
              </IconButton>
            </div>
            <Field label='Pin'>
              <Select
                value={String(b.pin)}
                options={pinOptions}
                onChange={v => vm.setButton(b.id, { pin: Number(v) })}
              />
            </Field>
            <Field label='Sends'>
              <Select
                value={b.key}
                options={BUTTON_KEYS.map(k => ({ value: k.value, label: k.label }))}
                onChange={v => vm.setButton(b.id, { key: v as ButtonKey })}
              />
            </Field>
            <Field label='Pressed'>
              <Select
                value={b.activeLow ? "low" : "high"}
                options={[
                  { value: "low", label: "Pulls the pin low (to GND)" },
                  { value: "high", label: "Pulls the pin high (to 3V3)" },
                ]}
                onChange={v => vm.setButton(b.id, { activeLow: v === "low" })}
              />
            </Field>
          </div>
        ))}
      </div>
      <div>
        <Button icon={<Plus />} onClick={vm.addButton}>
          Add button
        </Button>
      </div>
    </>
  )
}

function PinsSection({ vm }: { vm: VM }) {
  return (
    <>
      <Heading title='Pin check'>
        Every GPIO the project uses, checked against the {vm.mcu}: clashes, strapping pins, flash
        and USB pins, and ADC capability.
      </Heading>
      {vm.problems.length === 0 ? (
        <Hint tone='ok'>All {vm.mcu} pins check out.</Hint>
      ) : (
        vm.problems.map((p, i) => (
          <Hint key={i} tone={p.level === "error" ? "error" : "warn"}>
            {p.message}
          </Hint>
        ))
      )}
      <table className={s.pinTable}>
        <thead>
          <tr>
            <th>GPIO</th>
            <th>Used by</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {vm.claims.map((c, i) => (
            <tr key={i} data-problem={vm.problems.some(p => p.pin === c.pin) || undefined}>
              <td>{c.pin}</td>
              <td>{c.who}</td>
              <td>{vm.pins.reserved[c.pin] ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function MemorySection({ vm }: { vm: VM }) {
  return (
    <>
      <Heading title='Memory'>
        An estimate of the build against this board's real limits, counting fonts, images and LVGL's
        heap.
      </Heading>
      <Meter
        title='Flash'
        used={vm.budget.flash.used}
        total={vm.budget.flash.total}
        parts={vm.budget.flash.parts}
      />
      <Meter
        title='RAM'
        used={vm.budget.ram.used}
        total={vm.budget.ram.total}
        parts={vm.budget.ram.parts}
      />
      <Hint>
        Flash is the app partition PlatformIO gives this board. LVGL's heap is set to{" "}
        {formatBytes(vm.budget.lvglHeap)} in the exported lv_conf.h
        {vm.budget.layer && (
          <>
            , with {formatBytes(vm.budget.layer.bytes)} of it for drawing “{vm.budget.layer.name}”
            rotated or scaled
          </>
        )}
        .
        {vm.budget.heapShort &&
          " That's as much as this board holds, less than the UI wants: LVGL will skip drawing what doesn't fit (often a big rotated or scaled widget)."}
      </Hint>
    </>
  )
}

function PlatformioSection({ vm }: { vm: VM }) {
  // generated on demand: the rest of the dialog shouldn't pay for it
  const files = useMemo(vm.pioFiles, [vm.project])
  return (
    <>
      <Heading title='PlatformIO'>
        What these settings become in the exported project. Kiln regenerates both files on every
        export.
      </Heading>
      {files.map(f => (
        <div key={f.path} className={s.file}>
          <code className={s.fileName}>{f.path}</code>
          <pre>{f.content}</pre>
        </div>
      ))}
    </>
  )
}

const COLORS = ["var(--cyan)", "var(--purple)", "var(--accent)", "var(--green)", "var(--orange)"]

function Meter({
  title,
  used,
  total,
  parts,
}: {
  title: string
  used: number
  total: number
  parts: { label: string; bytes: number }[]
}) {
  return (
    <div className={s.meter}>
      <div className={s.meterHead}>
        <span>{title}</span>
        <span className={used > total ? s.over : ""}>
          {formatBytes(used)} of {formatBytes(total)}
        </span>
      </div>
      <div className={s.bar}>
        {parts.map((p, i) => (
          <span
            key={p.label}
            title={`${p.label}: ${formatBytes(p.bytes)}`}
            style={{
              width: `${Math.min(100, (p.bytes / total) * 100)}%`,
              background: COLORS[i % COLORS.length],
            }}
          />
        ))}
      </div>
      <div className={s.legend}>
        {parts.map((p, i) => (
          <span key={p.label}>
            <i style={{ background: COLORS[i % COLORS.length] }} /> {p.label} {formatBytes(p.bytes)}
          </span>
        ))}
      </div>
    </div>
  )
}
