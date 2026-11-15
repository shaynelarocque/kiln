import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { useProjectStore } from "@/entities/project"
import {
  activate,
  closeTab,
  moveTab,
  showHome,
  tabProject,
  useWorkspace,
} from "@/features/project-file"
import { inTauri, invoke, onMac, windowLabel } from "@/shared/lib/tauri"

/** macOS draws the tab strip itself (src-tauri/src/titlebar.rs); the page only keeps its state. */
export const nativeTabs = () => inTauri() && onMac() && windowLabel() === "main"

const palette = () => {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    bg: v("--bg"),
    hover: v("--bg-hover"),
    line: v("--line"),
    text: v("--text-strong"),
    dim: v("--text-dim"),
    faint: v("--text-faint"),
    accent: v("--accent"),
  }
}

/** Pushes the tabs (and the theme's colours) to the native strip, and applies its clicks. */
export function useNativeTabs() {
  const { tabs, active, home } = useWorkspace()
  // names and dirty dots follow the live tab's edits
  const doc = useProjectStore(st => st.doc)
  const saved = useProjectStore(st => st.saved)
  const on = nativeTabs()

  useEffect(() => {
    if (!on) return
    const push = () =>
      void invoke("tabs_set", {
        state: {
          tabs: tabs.map(t => {
            const p = tabProject(t)
            return { id: t.id, title: p.doc.name, path: p.path ?? null, dirty: p.doc !== p.saved }
          }),
          active,
          home,
          palette: palette(),
        },
      })
    push()
    // the theme can change under us (Settings, or the system)
    const mo = new MutationObserver(push)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    const mq = matchMedia("(prefers-color-scheme: dark)")
    mq.addEventListener("change", push)
    return () => {
      mo.disconnect()
      mq.removeEventListener("change", push)
    }
  }, [on, tabs, active, home, doc, saved])

  useEffect(() => {
    if (!on) return
    const un = listen<{ kind: string; id: string | null; to: number | null }>(
      "tabs-action",
      ({ payload: a }) => {
        if (a.kind === "home" || a.kind === "add") showHome()
        else if (a.kind === "activate" && a.id) activate(a.id)
        else if (a.kind === "move" && a.id && a.to != null) moveTab(a.id, a.to)
        else if (a.kind === "close" && a.id) void closeTab(a.id)
      },
    )
    return () => void un.then(f => f())
  }, [on])
}
