// DDS read and write in one module (design spec, External tools). Writes uncompressed 32-bit BGRA (A8R8G8B8, no mipmaps): lossless and simple.
// shortcut: no BC3/DXT5 compression (4x larger files); add a BC3 encoder if texture size matters.
import type { Rgba } from './png'

const MAGIC = 0x20534444 // "DDS "
const DDSD_CAPS = 0x1, DDSD_HEIGHT = 0x2, DDSD_WIDTH = 0x4, DDSD_PITCH = 0x8, DDSD_PIXELFORMAT = 0x1000, DDSD_MIPMAPCOUNT = 0x20000
const DDPF_ALPHAPIXELS = 0x1, DDPF_FOURCC = 0x4, DDPF_RGB = 0x40
const DDSCAPS_TEXTURE = 0x1000

/** 128-byte header + BGRA pixels, top row first. Straight alpha, as the game's textures are. */
export function writeDds(img: Rgba): Buffer {
  const { width: w, height: h } = img
  const out = Buffer.alloc(128 + w * h * 4)
  out.writeUInt32LE(MAGIC, 0)
  out.writeUInt32LE(124, 4)
  out.writeUInt32LE(DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PITCH | DDSD_PIXELFORMAT, 8)
  out.writeUInt32LE(h, 12)
  out.writeUInt32LE(w, 16)
  out.writeUInt32LE(w * 4, 20) // pitch
  // depth, mipMapCount, reserved1[11] stay 0
  out.writeUInt32LE(32, 76) // pixel format size
  out.writeUInt32LE(DDPF_RGB | DDPF_ALPHAPIXELS, 80)
  out.writeUInt32LE(32, 88) // bits per pixel
  out.writeUInt32LE(0x00ff0000, 92) // R
  out.writeUInt32LE(0x0000ff00, 96) // G
  out.writeUInt32LE(0x000000ff, 100) // B
  out.writeUInt32LE(0xff000000, 104) // A
  out.writeUInt32LE(DDSCAPS_TEXTURE, 108)
  for (let i = 0; i < w * h; i++) {
    const s = i * 4, d = 128 + i * 4
    out[d] = img.rgba[s + 2]!
    out[d + 1] = img.rgba[s + 1]!
    out[d + 2] = img.rgba[s]!
    out[d + 3] = img.rgba[s + 3]!
  }
  return out
}

export interface DdsHeader {
  width: number
  height: number
  mipMaps: number
  /** `BGRA8` / `BGR8` for uncompressed RGB masks in that order, the FourCC (`DXT1`, `DXT5`, `DX10`...) for compressed, else `RGB<bits>`. */
  format: string
}

/** Reads the header of any DDS (also the game's compressed ones). Throws when the magic or header size is wrong. */
export function readDdsHeader(b: Buffer): DdsHeader {
  if (b.length < 128 || b.readUInt32LE(0) !== MAGIC || b.readUInt32LE(4) !== 124 || b.readUInt32LE(76) !== 32) throw new Error('not a DDS file')
  const flags = b.readUInt32LE(8)
  const pf = b.readUInt32LE(80)
  let format: string
  if (pf & DDPF_FOURCC) format = b.toString('ascii', 84, 88)
  else {
    const bits = b.readUInt32LE(88)
    const bgr = b.readUInt32LE(92) === 0xff0000 && b.readUInt32LE(96) === 0xff00 && b.readUInt32LE(100) === 0xff
    format = bgr && bits === 32 && pf & DDPF_ALPHAPIXELS && b.readUInt32LE(104) === 0xff000000 ? 'BGRA8' : bgr && bits === 24 ? 'BGR8' : `RGB${bits}`
  }
  return { width: b.readUInt32LE(16), height: b.readUInt32LE(12), mipMaps: flags & DDSD_MIPMAPCOUNT ? Math.max(1, b.readUInt32LE(28)) : 1, format }
}

/** Pixels of an uncompressed BGRA8 DDS (the format `writeDds` emits), back to RGBA; for tests and checks. */
export function readDdsBgra8(b: Buffer): Rgba {
  const h = readDdsHeader(b)
  if (h.format !== 'BGRA8') throw new Error(`DDS format ${h.format} is not uncompressed BGRA8`)
  if (b.length < 128 + h.width * h.height * 4) throw new Error('truncated DDS pixel data')
  const rgba = Buffer.alloc(h.width * h.height * 4)
  for (let i = 0; i < h.width * h.height; i++) {
    const s = 128 + i * 4, d = i * 4
    rgba[d] = b[s + 2]!
    rgba[d + 1] = b[s + 1]!
    rgba[d + 2] = b[s]!
    rgba[d + 3] = b[s + 3]!
  }
  return { width: h.width, height: h.height, rgba }
}
