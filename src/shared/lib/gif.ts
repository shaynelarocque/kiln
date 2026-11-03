/** One frame of an animated GIF, composed onto the whole canvas, and how long it shows. */
export type GifFrame = { rgba: Uint8ClampedArray; delay: number }

/**
 * Decodes a GIF into full-canvas RGBA frames, applying transparency, interlacing and each
 * frame's disposal like a browser does. Plain TypeScript: WebKit (the desktop app's engine) has
 * no ImageDecoder to hand out GIF frames.
 */
export function decodeGif(bytes: Uint8Array): {
  width: number
  height: number
  frames: GifFrame[]
} {
  const sig = String.fromCharCode(...bytes.subarray(0, 6))
  if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("That isn't a GIF.")
  let pos = 6
  const u8 = () => {
    if (pos >= bytes.length) throw new Error("The GIF is cut short.")
    return bytes[pos++]
  }
  const u16 = () => u8() | (u8() << 8)
  const table = (flags: number) => {
    const size = 3 << ((flags & 7) + 1)
    const colors = bytes.subarray(pos, pos + size)
    pos += size
    return colors
  }
  /** A run of data sub-blocks, joined. */
  const blocks = () => {
    const parts: Uint8Array[] = []
    for (let n = u8(); n; n = u8()) {
      parts.push(bytes.subarray(pos, pos + n))
      pos += n
    }
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
    return out
  }

  const width = u16()
  const height = u16()
  const screen = u8()
  pos += 2 // background colour index and aspect ratio: browsers leave the background transparent
  const global = screen & 0x80 ? table(screen) : null
  const canvas = new Uint8ClampedArray(width * height * 4)
  const frames: GifFrame[] = []
  // a graphic control extension describes the one image that follows it
  let control = { delay: 0, transparent: -1, disposal: 0 }

  while (pos < bytes.length) {
    const block = u8()
    if (block === 0x3b) break
    if (block === 0x21) {
      if (u8() !== 0xf9) {
        blocks()
        continue
      }
      u8() // block size, always 4
      const flags = u8()
      const delay = u16() * 10
      const index = u8()
      u8() // terminator
      control = { delay, transparent: flags & 1 ? index : -1, disposal: (flags >> 2) & 7 }
      continue
    }
    if (block !== 0x2c) throw new Error("The GIF has a block Kiln doesn't know.")
    const left = u16()
    const top = u16()
    const w = u16()
    const h = u16()
    const flags = u8()
    const colors = flags & 0x80 ? table(flags) : global
    if (!colors) throw new Error("A GIF frame has no colours.")
    const minCodeSize = u8()
    const indices = decompress(blocks(), minCodeSize, w * h)
    const rows = flags & 0x40 ? interlaced(h) : null
    const before = control.disposal === 3 ? canvas.slice() : null

    for (let y = 0; y < h; y++) {
      const cy = top + (rows ? rows[y] : y)
      if (cy >= height) continue
      for (let x = 0; x < w; x++) {
        const index = indices[y * w + x]
        const cx = left + x
        if (index === control.transparent || cx >= width) continue
        const o = (cy * width + cx) * 4
        canvas[o] = colors[index * 3]
        canvas[o + 1] = colors[index * 3 + 1]
        canvas[o + 2] = colors[index * 3 + 2]
        canvas[o + 3] = 255
      }
    }
    // browsers show a 0 or near-0 delay as a tenth of a second
    frames.push({ rgba: canvas.slice(), delay: control.delay < 20 ? 100 : control.delay })

    if (control.disposal === 2)
      for (let y = top; y < Math.min(height, top + h); y++)
        canvas.fill(0, (y * width + left) * 4, (y * width + Math.min(width, left + w)) * 4)
    else if (before) canvas.set(before)
    control = { delay: 0, transparent: -1, disposal: 0 }
  }
  if (!frames.length) throw new Error("The GIF has no frames.")
  return { width, height, frames }
}

/** Where each stored row of an interlaced image goes: rows 0, 8, 16…, then 4, 12…, 2, 6…, 1, 3… */
function interlaced(height: number) {
  const order: number[] = []
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ])
    for (let y = start; y < height; y += step) order.push(y)
  return order
}

/** GIF's variable-width LZW, into `count` colour indices (a short stream leaves the rest 0). */
function decompress(data: Uint8Array, minCodeSize: number, count: number) {
  const out = new Uint8Array(count)
  const clear = 1 << minCodeSize
  const end = clear + 1
  // the table: each code is a previous code plus one index; head is its string's first index
  const prefix = new Int16Array(4096)
  const suffix = new Uint8Array(4096)
  const head = new Uint8Array(4096)
  const length = new Uint16Array(4096)
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1
    suffix[i] = head[i] = i
    length[i] = 1
  }
  let size = minCodeSize + 1
  let next = end + 1
  let prev = -1
  let at = 0
  let bits = 0
  let acc = 0
  let p = 0

  const write = (code: number) => {
    const n = length[code]
    for (let k = n - 1, c = code; k >= 0; k--, c = prefix[c])
      if (at + k < count) out[at + k] = suffix[c]
    at += n
  }

  while (at < count) {
    while (bits < size && p < data.length) {
      acc |= data[p++] << bits
      bits += 8
    }
    if (bits < size) break
    const code = acc & ((1 << size) - 1)
    acc >>>= size
    bits -= size
    if (code === clear) {
      size = minCodeSize + 1
      next = end + 1
      prev = -1
      continue
    }
    if (code === end) break
    if (prev === -1) {
      if (code >= clear) break
      write(code)
      prev = code
      continue
    }
    let first: number
    if (code < next) {
      write(code)
      first = head[code]
    } else if (code === next) {
      // the code being defined right now: the previous string plus its own first index
      first = head[prev]
      write(prev)
      if (at < count) out[at] = first
      at++
    } else break // corrupt: a code past the end of the table
    if (next < 4096) {
      prefix[next] = prev
      suffix[next] = first
      head[next] = head[prev]
      length[next] = length[prev] + 1
      next++
      if (next === 1 << size && size < 12) size++
    }
    prev = code
  }
  return out
}
