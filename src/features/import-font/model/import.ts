import { editorApi } from "@/entities/editor"
import { edit, newId, type FontAsset } from "@/entities/project"
import { toBase64 } from "@/shared/lib/base64"
import { getRuntime } from "@/shared/lvgl"
import { fontFileProblem } from "../lib/check"

/** Adds TTF/OTF files as project fonts, once the same TinyTTF the board runs has opened each one. */
export async function importFonts(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const problem = fontFileProblem(bytes) ?? ((await getRuntime()).canReadFont(bytes) ? null : "LVGL's TinyTTF can't read it.")
      if (problem) throw new Error(problem)
      const font: FontAsset = { id: newId(), name: file.name.replace(/\.\w+$/, ""), data: toBase64(bytes) }
      edit(d => void d.fonts.push(font))
    } catch (e) {
      editorApi.getState().set({ error: `Couldn't import ${file.name}: ${e instanceof Error ? e.message : e}` })
    }
  }
}
