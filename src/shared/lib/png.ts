import { toBase64 } from "./base64"
import { crc32 } from "./zip"

/** RGBA pixels as a PNG data: URL. Stored, not compressed: plenty for pixel art. */
export function pngDataUrl(width: number, height: number, rgba: Uint8Array) {
  // every scanline leads with its filter type, 0 (none)
  const row = width * 4 + 1
  const raw = new Uint8Array(height * row)
  for (let y = 0; y < height; y++)
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * row + 1)

  // zlib around stored deflate blocks of up to 65535 bytes, then the Adler-32
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  z.set([0x78, 0x01])
  let at = 2
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, (i + 1) * 65535)
    z.set(
      [
        i === blocks - 1 ? 1 : 0,
        part.length & 0xff,
        part.length >> 8,
        ~part.length & 0xff,
        (~part.length >> 8) & 0xff,
      ],
      at,
    )
    z.set(part, at + 5)
    at += 5 + part.length
  }
  let a = 1
  let b = 0
  for (const byte of raw) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  new DataView(z.buffer).setUint32(at, ((b << 16) | a) >>> 0)

  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  // 8 bits per channel, RGBA, no interlacing
  header.set([8, 6, 0, 0, 0], 8)
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", z),
    chunk("IEND", new Uint8Array()),
  ]
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((offset, p) => (png.set(p, offset), offset + p.length), 0)
  return `data:image/png;base64,${toBase64(png)}`
}
