import { Check, Hammer, LoaderCircle, Plug, Square, TriangleAlert, Upload } from "lucide-react"
import { useEffect, useState } from "react"
import { deviceApi, useDevice } from "@/entities/device"
import { build, showOutput, stopBuild, toggleMonitor } from "@/features/export-firmware"
import { IconButton } from "@/shared/ui"
import s from "./toolbar.module.css"

/** How long a finished build's result stays in the toolbar. */
const RESULT_MS = 8000

/**
 * Build, flash and the serial monitor, PlatformIO-style: they run in the background, and the
 * toolbar says how it's going. Clicking the status opens the log.
 */
export function DeviceControls() {
  const job = useDevice(d => d.job)
  const progress = useDevice(d => d.progress)
  const finishedAt = useDevice(d => d.finishedAt)
  const monitor = useDevice(d => d.monitor)
  const [, tick] = useState(0)
  // let the result fade after a while
  useEffect(() => {
    if (!finishedAt) return
    const t = setTimeout(() => tick(n => n + 1), RESULT_MS)
    return () => clearTimeout(t)
  }, [finishedAt])
  if (!deviceApi.available()) return null

  const monitoring = Boolean(monitor && monitor.status !== "closed")
  const recent = finishedAt && Date.now() - finishedAt < RESULT_MS
  const upload = job?.kind === "upload"
  let status: React.ReactNode = null
  if (job?.running)
    status = (
      <>
        <LoaderCircle className={s.spin} />
        {progress !== null
          ? `Flashing ${Math.round(progress * 100)}%`
          : upload
            ? "Building to flash…"
            : "Building…"}
      </>
    )
  else if (job && recent && !job.stopped)
    status =
      job.code === 0 ? (
        <>
          <Check />
          {upload ? "Flashed" : "Built"}
        </>
      ) : (
        <>
          <TriangleAlert />
          {upload ? "Flash failed" : "Build failed"}
        </>
      )

  return (
    <span className={s.device}>
      {status && (
        <button
          className={s.jobStatus}
          data-tone={job?.running ? "running" : job?.code === 0 ? "good" : "error"}
          onClick={() => showOutput("build")}
          title='Show the build log (⌘J)'
        >
          {status}
        </button>
      )}
      {job?.running ? (
        <IconButton label='Stop (⌘.)' onClick={stopBuild}>
          <Square />
        </IconButton>
      ) : (
        <>
          <IconButton label='Build (⌘B)' onClick={() => build(false)}>
            <Hammer />
          </IconButton>
          <IconButton label='Build and flash (⌘U)' onClick={() => build(true)}>
            <Upload />
          </IconButton>
        </>
      )}
      <IconButton
        label={monitoring ? "Disconnect the serial monitor (⇧⌘M)" : "Serial monitor (⇧⌘M)"}
        active={monitoring}
        onClick={toggleMonitor}
      >
        <Plug />
      </IconButton>
    </span>
  )
}
