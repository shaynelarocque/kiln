import { Search } from "lucide-react"
import { DISPLAY_DRIVERS, DISPLAY_PRESETS, formatBytes } from "@/entities/board"
import type { DisplayConfig } from "@/entities/project"
import { Button, Dialog, Field, Hint, NumberInput, Select, Toggle } from "@/shared/ui"
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

export function BoardDialog() {
  const vm = useBoardDialog()
  const d = vm.display
  const pinOptions = [
    { value: "-1", label: "Not connected" },
    ...vm.pins.gpios.map(p => ({
      value: String(p),
      label: `GPIO${p}${vm.pins.reserved[p] ? ` · ${vm.pins.reserved[p]}` : ""}`,
    })),
  ]
  return (
    <Dialog
      title='Board, display and pins'
      onClose={vm.close}
      wide
      footer={
        <Button variant='primary' onClick={vm.close}>
          Done
        </Button>
      }
    >
      <div className={s.grid}>
        <section>
          <h3>Board</h3>
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
        </section>

        <section>
          <h3>Display</h3>
          <Field label='Module'>
            <Select
              value={vm.presetIndex >= 0 ? String(vm.presetIndex) : ""}
              placeholder='Custom'
              options={DISPLAY_PRESETS.map((p, i) => ({ value: String(i), label: p.label }))}
              onChange={i => i !== "" && vm.applyPreset(DISPLAY_PRESETS[Number(i)])}
            />
          </Field>
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
            Wrong colours or a shifted picture on the real panel? Inversion, red/blue and the
            offsets are the usual fixes.
          </Hint>
        </section>

        <section>
          <h3>Wiring</h3>
          {PIN_LABELS.map(p => (
            <Field key={p.key} label={p.label}>
              <Select
                value={String(d.pins[p.key])}
                options={pinOptions}
                onChange={v => vm.setPin(p.key, Number(v))}
              />
            </Field>
          ))}
          <div className={s.problems}>
            {vm.problems.length === 0 ? (
              <Hint tone='ok'>All {vm.mcu} pins check out.</Hint>
            ) : (
              vm.problems.map((p, i) => (
                <Hint key={i} tone={p.level === "error" ? "error" : "warn"}>
                  {p.message}
                </Hint>
              ))
            )}
          </div>

          <h3>Budget (estimated)</h3>
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
                , with {formatBytes(vm.budget.layer.bytes)} of it for drawing “
                {vm.budget.layer.name}” rotated or scaled
              </>
            )}
            .
          </Hint>
        </section>
      </div>
    </Dialog>
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
