import { House, Plus, X } from "lucide-react"
import { useProjectStore } from "@/entities/project"
import {
  activate,
  closeTab,
  showHome,
  tabProject,
  useWorkspace,
  type Tab,
} from "@/features/project-file"
import s from "./tab-bar.module.css"

/** Figma's tab strip: home, then one tab per open project. It's also the window's title bar. */
export function TabBar() {
  const { tabs, active, home } = useWorkspace()
  // the live tab's name and dirty dot follow its edits
  useProjectStore(st => st.doc)
  useProjectStore(st => st.saved)
  return (
    <div className={s.bar} data-tauri-drag-region>
      <button
        className={s.home}
        aria-current={home ? "page" : undefined}
        onClick={showHome}
        title='Projects (⇧⌘H)'
        aria-label='Projects'
      >
        <House />
      </button>
      <div className={s.tabs} role='tablist' data-tauri-drag-region>
        {tabs.map(t => (
          <TabButton key={t.id} tab={t} current={!home && t.id === active} />
        ))}
        <button
          className={s.add}
          onClick={showHome}
          title='New or open a project'
          aria-label='New tab'
        >
          <Plus />
        </button>
      </div>
    </div>
  )
}

function TabButton({ tab, current }: { tab: Tab; current: boolean }) {
  const p = tabProject(tab)
  const dirty = p.doc !== p.saved
  return (
    <div
      className={s.tab}
      role='tab'
      aria-selected={current}
      title={p.path ?? p.doc.name}
      onPointerDown={e => e.button === 0 && activate(tab.id)}
      onAuxClick={e => e.button === 1 && closeTab(tab.id)}
    >
      <span className={s.name}>{p.doc.name}</span>
      <button
        className={s.close}
        data-dirty={dirty || undefined}
        aria-label={`Close ${p.doc.name}`}
        title={dirty ? "Unsaved changes. Close" : "Close (⌘W)"}
        onPointerDown={e => e.stopPropagation()}
        onClick={() => closeTab(tab.id)}
      >
        <X />
      </button>
    </div>
  )
}
