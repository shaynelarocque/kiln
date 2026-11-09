import { Beer, FilePlus, FolderOpen, Thermometer, X } from "lucide-react"
import {
  forgetRecent,
  newProject,
  openPath,
  openProject,
  savedHardware,
  TEMPLATES,
  useRecent,
} from "@/features/project-file"
import { inTauri } from "@/shared/lib/tauri"
import { Button } from "@/shared/ui"
import s from "./home.module.css"

const ICONS: Record<string, React.ReactNode> = {
  blank: <FilePlus />,
  thermostat: <Thermometer />,
  pet: <Beer />,
}

/** "just now", "5 min ago", "yesterday", "12 Oct". */
function ago(at: number) {
  const s = (Date.now() - at) / 1000
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 172800) return "yesterday"
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

/** Where projects start: new ones from templates, and the files opened lately. */
export function HomePage() {
  const recent = useRecent(r => r.list)
  const hardware = savedHardware()
  const desktop = inTauri()
  return (
    <main className={s.page}>
      <div className={s.inner}>
        <header className={s.head}>
          <h1>Projects</h1>
          <Button icon={<FolderOpen />} onClick={openProject}>
            Open…
          </Button>
        </header>

        <section>
          <h2>Start something new</h2>
          <div className={s.templates}>
            {TEMPLATES.map(t => (
              <button key={t.value} className={s.template} onClick={() => newProject(t.value)}>
                <span className={s.icon}>{ICONS[t.value]}</span>
                <strong>{t.label}</strong>
                <small>{t.note}</small>
              </button>
            ))}
          </div>
          <p className={s.note}>
            {hardware
              ? `New projects start on your ${hardware.board} with its ${hardware.display.driver.toUpperCase()} panel; samples keep their own screen size.`
              : "Set up your board once (Board, display and pins) and new projects start on it."}
          </p>
        </section>

        {desktop && (
          <section>
            <h2>Recent</h2>
            {recent.length ? (
              <div className={s.recent}>
                {recent.map(r => (
                  <div key={r.path} className={s.card}>
                    <button className={s.open} onClick={() => openPath(r.path)} title={r.path}>
                      <span className={s.thumb}>
                        {r.thumb ? (
                          // a round panel's picture is the square the canvas draws it in
                          <img
                            src={r.thumb}
                            alt=''
                            data-round={r.display.endsWith(" round") || undefined}
                          />
                        ) : (
                          <span>{r.name.slice(0, 1)}</span>
                        )}
                      </span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.display} · {ago(r.at)}
                      </small>
                    </button>
                    <button
                      className={s.forget}
                      aria-label={`Remove ${r.name} from recents`}
                      title='Remove from recents'
                      onClick={() => forgetRecent(r.path)}
                    >
                      <X />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className={s.note}>Projects you open or save show up here.</p>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
