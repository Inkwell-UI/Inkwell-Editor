// Minimal PNG codec on node:zlib (no dependency): decode 8-bit non-interlaced PNGs (the Figma plugin re-encodes anything else), encode RGBA.
import { deflateSync, inflateSync } from 'node:zlib'

/** Straight (not premultiplied) RGBA, 4 bytes per pixel, rows top to bottom. */
export interface Rgba {
  width: number
  height: number
  rgba: Buffer
}

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** Width and height from the IHDR chunk, or undefined when this is not a PNG. Cheap: no inflate. */
export function pngSize(b: Buffer): { width: number; height: number } | undefined {
  if (b.length < 24 || !b.subarray(0, 8).equals(SIG) || b.toString('ascii', 12, 16) !== 'IHDR') return undefined
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

/** Throws a readable message on anything it does not support (bit depth other than 8, interlace, truncated data). */
export function decodePng(b: Buffer): Rgba {
  if (!pngSize(b)) throw new Error('not a PNG file')
  let p = 8
  let width = 0, height = 0, color = -1
  let palette: Buffer | undefined
  let trns: Buffer | undefined
  const idat: Buffer[] = []
  while (p + 8 <= b.length) {
    const len = b.readUInt32BE(p)
    const type = b.toString('ascii', p + 4, p + 8)
    const data = b.subarray(p + 8, p + 8 + len)
    if (data.length !== len) throw new Error('truncated PNG chunk')
    p += 12 + len
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const depth = data[8]!
      color = data[9]!
      if (depth !== 8 || !(color in CHANNELS)) throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${color}); only 8-bit PNGs are read`)
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported')
      if (!width || !height || width > 16384 || height > 16384) throw new Error(`PNG size ${width}x${height} is out of range`)
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
  }
  const ch = CHANNELS[color]
  if (!ch) throw new Error('PNG has no IHDR chunk')
  if (color === 3 && !palette) throw new Error('palette PNG without PLTE chunk')
  const stride = width * ch
  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length < (stride + 1) * height) throw new Error('truncated PNG image data')

  // unfilter in place into `px` (filters work on bytes, bpp = channels for 8-bit)
  const px = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!
    const src = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch]! : 0
      const up = y ? px[row - stride + x]! : 0
      const c = y && x >= ch ? px[row - stride + x - ch]! : 0
      let v = raw[src + x]!
      if (f === 1) v += a
      else if (f === 2) v += up
      else if (f === 3) v += (a + up) >> 1
      else if (f === 4) {
        const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c
      } else if (f !== 0) throw new Error(`bad PNG filter ${f}`)
      px[row + x] = v & 255
    }
  }

  const out = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (color === 6) px.copy(out, o, i * 4, i * 4 + 4)
    else if (color === 2) {
      px.copy(out, o, i * 3, i * 3 + 3)
      // tRNS for RGB: one 16-bit colour that is fully transparent
      out[o + 3] = trns && trns.length >= 6 && trns.readUInt16BE(0) === px[i * 3] && trns.readUInt16BE(2) === px[i * 3 + 1] && trns.readUInt16BE(4) === px[i * 3 + 2] ? 0 : 255
    } else if (color === 0 || color === 4) {
      const g = px[i * ch]!
      out[o] = out[o + 1] = out[o + 2] = g
      out[o + 3] = color === 4 ? px[i * 2 + 1]! : trns && trns.length >= 2 && trns.readUInt16BE(0) === g ? 0 : 255
    } else {
      const k = px[i]!
      if (k * 3 + 2 >= palette!.length) throw new Error('PNG palette index out of range')
      palette!.copy(out, o, k * 3, k * 3 + 3)
      out[o + 3] = trns && k < trns.length ? trns[k]! : 255
    }
  }
  return { width, height, rgba: out }
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(b: Buffer): number {
  let c = 0xffffffff
  for (const v of b) c = CRC[(c ^ v) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** RGBA -> PNG (colour type 6, filter 0 on every row). Used for synthetic test images. */
export function encodePng(img: Rgba): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) img.rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
