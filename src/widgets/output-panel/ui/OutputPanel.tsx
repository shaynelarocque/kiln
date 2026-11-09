import {
  Eraser,
  ExternalLink,
  Hammer,
  Plug,
  RefreshCw,
  RotateCcw,
  Square,
  Unplug,
  Upload,
  X,
} from "lucide-react"
import { useLayoutEffect, useRef } from "react"
import { toneOf } from "@/entities/device"
import { Button, IconButton, Select } from "@/shared/ui"
import { BAUDS, useOutput, type OutputViewModel } from "../model/use-output"
import s from "./output.module.css"

/**
 * The build log and the serial monitor, like PlatformIO's terminal panel: builds and the monitor
 * run in the background, so this only shows them. Docked under the canvas, or filling the
 * output window.
 */
export function OutputPanel({ docked }: { docked: boolean }) {
  const vm = useOutput(docked)
  return (
    <section className={`${s.panel} ${docked ? "" : s.window}`} aria-label='Build output'>
      <header className={s.head} data-tauri-drag-region={docked ? undefined : true}>
        <div className={s.tabs} role='tablist'>
          <button role='tab' aria-selected={vm.tab === "build"} onClick={() => vm.setTab("build")}>
            Build
            {vm.running && <span className={s.dot} data-tone='running' />}
          </button>
          <button
            role='tab'
            aria-selected={vm.tab === "monitor"}
            onClick={() => vm.setTab("monitor")}
          >
            Serial monitor
            {vm.monitorOpen && <span className={s.dot} data-tone={vm.monitor?.status} />}
          </button>
        </div>
        {vm.tab === "build" ? <BuildTools vm={vm} /> : <MonitorTools vm={vm} />}
        <span className={s.end}>
          <IconButton label='Clear' onClick={vm.clear}>
            <Eraser />
          </IconButton>
          {docked && vm.available && (
            <IconButton label='Open in its own window' onClick={vm.popOut}>
              <ExternalLink />
            </IconButton>
          )}
          {docked && (
            <IconButton label='Hide (⌘J)' onClick={vm.close}>
              <X />
            </IconButton>
          )}
        </span>
      </header>
      {!vm.available ? (
        <p className={s.empty}>
          Building, flashing and the serial monitor need the desktop app. In the browser, Export
          downloads the PlatformIO project as a .zip.
        </p>
      ) : vm.tab === "build" ? (
        <BuildLog vm={vm} />
      ) : (
        <Monitor vm={vm} />
      )}
    </section>
  )
}

function PortPicker({ vm, auto }: { vm: OutputViewModel; auto: string }) {
  return (
    <span className={s.port}>
      <Select
        className={s.picker}
        label='Port'
        value={vm.port}
        placeholder={auto}
        onChange={vm.setPort}
        onFocus={vm.refreshPorts}
        options={[
          ...(vm.port && !vm.ports.some(p => p.port === vm.port)
            ? [{ value: vm.port, label: `${vm.port} (not connected)` }]
            : []),
          ...vm.ports.map(p => ({
            value: p.port,
            label: `${p.port.replace(/^\/dev\//, "")}${p.description ? ` · ${p.description}` : ""}`,
          })),
        ]}
      />
      <IconButton label='Look for boards again' onClick={vm.refreshPorts}>
        <RefreshCw />
      </IconButton>
    </span>
  )
}

function BuildTools({ vm }: { vm: OutputViewModel }) {
  return (
    <div className={s.tools}>
      <span className={s.status} data-tone={vm.status.tone}>
        {vm.status.text}
      </span>
      {vm.running && vm.progress !== null && (
        <span className={s.progress} aria-hidden>
          <span style={{ width: `${vm.progress * 100}%` }} />
        </span>
      )}
      {vm.available &&
        (vm.running ? (
          <Button icon={<Square />} onClick={vm.stop} title='Stop (⌘.)'>
            Stop
          </Button>
        ) : (
          <>
            <PortPicker vm={vm} auto='Find the board' />
            <Button icon={<Hammer />} onClick={vm.build} title='Build (⌘B)'>
              Build
            </Button>
            <Button
              icon={<Upload />}
              variant='primary'
              onClick={vm.flash}
              title='Build and flash (⌘U)'
            >
              Flash
            </Button>
          </>
        ))}
    </div>
  )
}

const MONITOR_STATUS = {
  connected: "Connected",
  waiting: "Waiting for the board…",
  paused: "Paused while flashing",
  closed: "Closed",
}

function MonitorTools({ vm }: { vm: OutputViewModel }) {
  const m = vm.monitor
  return (
    <div className={s.tools}>
      {vm.monitorOpen && m ? (
        <span
          className={s.status}
          data-tone={m.status === "connected" ? "good" : "idle"}
          title={m.error ?? undefined}
        >
          {MONITOR_STATUS[m.status]} · {m.port.replace(/^\/dev\//, "")}
        </span>
      ) : (
        <PortPicker vm={vm} auto='First USB board' />
      )}
      {vm.available && (
        <>
          <Select
            className={s.picker}
            label='Speed'
            value={String(vm.baud)}
            onChange={v => vm.setBaud(Number(v))}
            options={BAUDS.map(b => ({ value: String(b), label: `${b} baud` }))}
          />
          {vm.monitorOpen && (
            <IconButton
              label='Reset the board'
              onClick={vm.reset}
              disabled={m?.status !== "connected"}
            >
              <RotateCcw />
            </IconButton>
          )}
          <Button
            icon={vm.monitorOpen ? <Unplug /> : <Plug />}
            variant={vm.monitorOpen ? "default" : "primary"}
            onClick={vm.toggleMonitor}
            title='Serial monitor (⇧⌘M)'
          >
            {vm.monitorOpen ? "Disconnect" : "Connect"}
          </Button>
        </>
      )}
    </div>
  )
}

/** Keeps a log pinned to its newest line, unless it's been scrolled up to read. */
function useFollow(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [dep])
  const onScroll = () => {
    const el = ref.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }
  return { ref, onScroll }
}

function Lines({ lines }: { lines: string[] }) {
  return lines.map((line, i) => (
    <div key={i} data-tone={toneOf(line) ?? undefined}>
      {line || " "}
    </div>
  ))
}

function BuildLog({ vm }: { vm: OutputViewModel }) {
  const follow = useFollow(vm.log)
  return (
    <div className={s.log} {...follow}>
      {vm.log.length ? (
        <Lines lines={vm.log} />
      ) : (
        <p className={s.empty}>
          Build compiles the exported PlatformIO project; Flash also uploads it to the board. Both
          run in the background, so keep designing while they do.
        </p>
      )}
    </div>
  )
}

function Monitor({ vm }: { vm: OutputViewModel }) {
  const follow = useFollow(vm.lines.length + vm.partial)
  const empty = !vm.lines.length && !vm.partial
  return (
    <>
      <div className={s.log} {...follow}>
        {empty ? (
          <p className={s.empty}>
            {vm.monitorOpen
              ? "Listening. The firmware logs at 115200 baud; LVGL's warnings show here too."
              : "Connect to see what the board prints. Flashing pauses the monitor and picks it up again after."}
          </p>
        ) : (
          <>
            <Lines lines={vm.lines} />
            {vm.partial && <div>{vm.partial}</div>}
          </>
        )}
      </div>
      {vm.monitorOpen && (
        <form
          className={s.send}
          onSubmit={e => {
            e.preventDefault()
            vm.send()
          }}
        >
          <input
            value={vm.draft}
            onChange={e => vm.setDraft(e.target.value)}
            placeholder='Send to the board (Enter adds a newline)'
            disabled={vm.monitor?.status !== "connected"}
            spellCheck={false}
          />
        </form>
      )}
    </>
  )
}
