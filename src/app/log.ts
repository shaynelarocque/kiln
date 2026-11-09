import { editorApi } from "@/entities/editor"
import { logError } from "@/shared/lib/log"

const describe = (e: unknown) => (e instanceof Error ? (e.stack ?? e.message) : String(e))

/** Sends the page's errors to the log file: uncaught ones, and every error the editor shows. */
export function startLogging() {
  const onError = (e: ErrorEvent) =>
    logError(e.error ? describe(e.error) : `${e.message} (${e.filename}:${e.lineno})`)
  const onRejection = (e: PromiseRejectionEvent) => logError(`unhandled: ${describe(e.reason)}`)
  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)
  // the preview, LVGL, imports, saving and builds all report through the editor's error
  const stop = editorApi.subscribe((s, prev) => {
    if (s.error && s.error !== prev.error) logError(s.error)
  })
  return () => {
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onRejection)
    stop()
  }
}
