// Writes consts.inc: every LVGL constant kiln_const() can resolve at runtime.
// That's all style props, plus any "LV_..." string literal the TS sources mention.
// Rebuild the runtime (pnpm runtime) after naming a new constant in TS; runtime.test.ts catches a stale build.
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const names = new Set()

const styleH = readFileSync(join(import.meta.dirname, "lvgl/include/lvgl/core/lv_style.h"), "utf8")
const styleEnum = styleH.slice(styleH.indexOf("LV_STYLE_PROP_INV"), styleH.indexOf("LV_STYLE_LAST_BUILT_IN_PROP"))
for (const [name] of styleEnum.matchAll(/LV_STYLE_[A-Z0-9_]+/g)) names.add(name)

const walk = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      for (const [, name] of readFileSync(path, "utf8").matchAll(/["'`](LV_[A-Z0-9_]+)["'`]/g))
        names.add(name)
  }
}
walk(join(root, "src"))

// Config switches, fonts and symbol strings aren't integer constants.
const list = [...names]
  .filter(n => !/^LV_(USE|FONT|SYMBOL|CONF)_/.test(n) && n !== "LV_COLOR_FORMAT_DEFAULT")
  .sort()
writeFileSync(join(import.meta.dirname, "consts.inc"), list.map(n => `K(${n})`).join("\n") + "\n")
console.log(`consts.inc: ${list.length} constants`)
