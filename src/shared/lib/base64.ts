/** Bytes as base64, in chunks: spreading a whole large file into fromCharCode overflows the stack. */
export function toBase64(bytes: Uint8Array) {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
