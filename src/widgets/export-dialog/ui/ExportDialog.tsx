import { Copy, Download, FolderOpen, Hammer, RefreshCw, Upload } from "lucide-react"
import { useEffect, useRef } from "react"
import { Button, Dialog, Hint, IconButton, Select } from "@/shared/ui"
import { useExport } from "../model/use-export"
import s from "./export-dialog.module.css"

export function ExportDialog() {
  const vm = useExport()
  const logEnd = useRef<HTMLDivElement>(null)
  useEffect(() => logEnd.current?.scrollIntoView({ block: "end" }), [vm.log.length])

  const footer = vm.desktop ? (
    <>
      <span className={s.folder} title={vm.folder ?? ""}>
        {vm.folder ?? "No folder yet"}
      </span>
      <Button icon={<FolderOpen />} onClick={vm.chooseFolder}>
        {vm.folder ? "Export to…" : "Export to folder…"}
      </Button>
      {vm.folder && (
        <>
          <Button onClick={vm.exportAgain}>Export</Button>
          <Button
            icon={<Hammer />}
            onClick={vm.build}
            disabled={!vm.pio?.path || Boolean(vm.running)}
          >
            {vm.running === "build" ? "Building…" : "Build"}
          </Button>
          <span className={s.port}>
            <Select
              value={vm.port}
              placeholder='Auto-detect port'
              options={vm.ports.map(p => ({
                value: p.port,
                label: `${p.port} ${p.description !== "n/a" ? `· ${p.description}` : ""}`,
              }))}
              onChange={vm.setPort}
            />
            <IconButton label='Refresh ports' onClick={vm.refreshPorts}>
              <RefreshCw />
            </IconButton>
          </span>
          <Button
            icon={<Upload />}
            variant='primary'
            onClick={vm.upload}
            disabled={!vm.pio?.path || Boolean(vm.running)}
          >
            {vm.running === "upload" ? "Flashing…" : "Build & flash"}
          </Button>
        </>
      )}
    </>
  ) : (
    <>
      <span className={s.folder}>
        In the desktop app, Kiln writes the folder and runs PlatformIO for you.
      </span>
      <Button icon={<Download />} variant='primary' onClick={vm.downloadZip}>
        Download .zip
      </Button>
    </>
  )

  return (
    <Dialog title='Export firmware' onClose={vm.close} wide footer={footer}>
      <div className={s.summary}>
        <span>
          <strong>{vm.board?.name ?? vm.project.target.board}</strong> ·{" "}
          {vm.project.target.display.driver.toUpperCase()} {vm.project.target.display.width}×
          {vm.project.target.display.height} · LVGL 9.6 · Arduino + LovyanGFX
        </span>
        {vm.desktop && (
          <span className={vm.pio?.path ? s.ok : s.warn}>
            {vm.pio === null
              ? "Looking for PlatformIO…"
              : vm.pio.path
                ? `${vm.pio.version ?? "PlatformIO"} ready`
                : "PlatformIO not found: export works, building needs it"}
          </span>
        )}
      </div>
      <div className={s.body}>
        <ul className={s.files}>
          {vm.files.map(f => (
            <li key={f.path}>
              <button aria-pressed={f.path === vm.file.path} onClick={() => vm.select(f.path)}>
                <span>{f.path}</span>
                {!f.overwrite && (
                  <em title='Written once, then yours: re-exporting never touches it'>yours</em>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className={s.code}>
          <div className={s.codeHead}>
            <code>{vm.file.path}</code>
            <IconButton label='Copy file' onClick={vm.copy}>
              <Copy />
            </IconButton>
          </div>
          <pre>
            {vm.file.content.split("\n").map((line, i) => (
              <span key={i}>{line + "\n"}</span>
            ))}
          </pre>
        </div>
      </div>
      {vm.status && (
        <Hint tone={/fail|exited|error/i.test(vm.status) ? "error" : "ok"}>{vm.status}</Hint>
      )}
      {vm.log.length > 0 && (
        <div className={s.log}>
          {vm.log.map((line, i) => (
            <div
              key={i}
              className={
                /error|failed/i.test(line)
                  ? s.err
                  : /SUCCESS|Wrote|Hash of data verified/i.test(line)
                    ? s.good
                    : ""
              }
            >
              {line}
            </div>
          ))}
          <div ref={logEnd} />
        </div>
      )}
    </Dialog>
  )
}
