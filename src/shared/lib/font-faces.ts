const faces = new Set<string>()

/**
 * The CSS family an imported font is registered under, so the editor's own text (samples, in-place
 * editing) can show it. The canvas itself is LVGL's TinyTTF, not this.
 */
export function fontFamily(id: string, base64: string) {
  const family = `kiln-${id}`
  if (!faces.has(id)) {
    faces.add(id)
    const face = new FontFace(family, Uint8Array.from(atob(base64), c => c.charCodeAt(0)))
    document.fonts.add(face)
    // the browser may refuse a font TinyTTF reads; the editor's text just keeps its usual face
    face.load().catch(() => {})
  }
  return family
}
