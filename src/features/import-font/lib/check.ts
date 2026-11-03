/** Past this, a font won't fit any app partition worth flashing it to. */
export const MAX_FONT_BYTES = 8 * 1024 * 1024

/** Why a file can't be imported as a font, or null if it looks like a TrueType or OpenType one. */
export function fontFileProblem(bytes: Uint8Array): string | null {
  const tag = String.fromCharCode(...bytes.subarray(0, 4))
  if (tag === "wOFF" || tag === "wOF2")
    return "That's a WOFF web font. Import its .ttf or .otf instead."
  // TrueType ("\0\1\0\0" or Apple's "true"), OpenType with CFF outlines, or a collection (its first face)
  if (!["\0\x01\0\0", "true", "OTTO", "ttcf"].includes(tag))
    return "That isn't a TrueType or OpenType font."
  if (bytes.length > MAX_FONT_BYTES) return "It's over 8 MB, more than a microcontroller can hold."
  return null
}
