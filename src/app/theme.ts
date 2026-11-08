import { useSettings, type Theme } from "@/shared/config"
import { inTauri } from "@/shared/lib/tauri"

const media = () => window.matchMedia("(prefers-color-scheme: dark)")

/** Puts the chosen theme on <html> (global.css keys off data-theme) and the window's chrome. */
function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && media().matches)
  document.documentElement.dataset.theme = dark ? "dark" : "light"
}

/**
 * Applies the theme now, before the first paint, and again whenever Settings or the system
 * changes it. In the app, the native title bar and traffic lights follow too.
 */
export function startTheme() {
  apply(useSettings.getState().theme)
  media().addEventListener("change", () => apply(useSettings.getState().theme))
  let last = useSettings.getState().theme
  const native = (theme: Theme) =>
    inTauri() &&
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .setTheme(theme === "system" ? null : theme)
        .catch(() => {}),
    )
  native(last)
  useSettings.subscribe(s => {
    if (s.theme === last) return
    last = s.theme
    apply(s.theme)
    native(s.theme)
  })
}
