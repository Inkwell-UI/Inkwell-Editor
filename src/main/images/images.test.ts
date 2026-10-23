import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createAssetStore, ddsRel, isAssetHash } from './assets'
import { readDdsBgra8, readDdsHeader, writeDds } from './dds'
import { decodePng, encodePng, pngSize, type Rgba } from './png'
import { syntheticPng } from './synthetic'

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
/** A PNG built by hand: `rows` are already filtered (first byte = filter type). */
const rawPng = (w: number, h: number, color: number, rows: Buffer, extra: Buffer[] = [], depth = 8, interlace = 0): Buffer => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = depth
  ihdr[9] = color
  ihdr[12] = interlace
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
/** Filters RGBA rows with the given filter per row (the PNG encoder side), to test the decoder's unfiltering. */
function filtered(img: Rgba, filters: number[]): Buffer {
  const stride = img.width * 4
  const out: number[] = []
  for (let y = 0; y < img.height; y++) {
    const f = filters[y % filters.length]!
    out.push(f)
    for (let x = 0; x < stride; x++) {
      const v = img.rgba[y * stride + x]!
      const a = x >= 4 ? img.rgba[y * stride + x - 4]! : 0
      const b = y ? img.rgba[(y - 1) * stride + x]! : 0
      const c = y && x >= 4 ? img.rgba[(y - 1) * stride + x - 4]! : 0
      const p = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c)
      out.push((v - p) & 255)
    }
  }
  return Buffer.from(out)
}

describe('png', () => {
  const { png, image } = syntheticPng(13, 7)

  it('round-trips RGBA through encodePng/decodePng and reads the size cheaply', () => {
    expect(decodePng(png)).toEqual(image)
    expect(pngSize(png)).toEqual({ width: 13, height: 7 })
    expect(pngSize(Buffer.from('GIF89a'))).toBeUndefined()
  })

  it('undoes all five filter types', () => {
    expect(decodePng(rawPng(13, 7, 6, filtered(image, [0, 1, 2, 3, 4])))).toEqual(image)
    expect(decodePng(rawPng(13, 7, 6, filtered(image, [4, 3, 2, 1])))).toEqual(image)
  })

  it('reads RGB, grey, grey+alpha and palette (with tRNS) to RGBA', () => {
    expect(decodePng(rawPng(2, 1, 2, Buffer.from([0, 1, 2, 3, 4, 5, 6]))).rgba).toEqual(Buffer.from([1, 2, 3, 255, 4, 5, 6, 255]))
    expect(decodePng(rawPng(2, 1, 0, Buffer.from([0, 9, 200]))).rgba).toEqual(Buffer.from([9, 9, 9, 255, 200, 200, 200, 255]))
    expect(decodePng(rawPng(1, 1, 4, Buffer.from([0, 7, 128]))).rgba).toEqual(Buffer.from([7, 7, 7, 128]))
    const plte = chunk('PLTE', Buffer.from([10, 20, 30, 40, 50, 60]))
    const trns = chunk('tRNS', Buffer.from([0]))
    expect(decodePng(rawPng(2, 1, 3, Buffer.from([0, 0, 1]), [plte, trns])).rgba).toEqual(Buffer.from([10, 20, 30, 0, 40, 50, 60, 255]))
  })

  it('refuses what it cannot read with a clear message', () => {
    expect(() => decodePng(Buffer.from('not a png at all, really not'))).toThrow('not a PNG')
    expect(() => decodePng(rawPng(1, 1, 6, Buffer.alloc(9), [], 16))).toThrow('bit depth 16')
    expect(() => decodePng(rawPng(1, 1, 6, Buffer.alloc(5), [], 8, 1))).toThrow('interlaced')
    expect(() => decodePng(rawPng(2, 2, 6, Buffer.alloc(3)))).toThrow('truncated')
    expect(() => decodePng(png.subarray(0, png.length - 20))).toThrow()
  })
})

describe('dds', () => {
  const { image } = syntheticPng(4, 2)

  it('writes an uncompressed BGRA8 DDS with a standard 128-byte header', () => {
    const d = writeDds(image)
    expect(d.length).toBe(128 + 4 * 2 * 4)
    expect(d.toString('ascii', 0, 4)).toBe('DDS ')
    expect(readDdsHeader(d)).toEqual({ width: 4, height: 2, mipMaps: 1, format: 'BGRA8' })
    expect(d.readUInt32LE(20)).toBe(16) // pitch
    expect([...d.subarray(128, 132)]).toEqual([image.rgba[2], image.rgba[1], image.rgba[0], image.rgba[3]]) // B G R A
    expect(readDdsBgra8(d)).toEqual(image)
  })

  it('reads the header of compressed textures (FourCC) and rejects non-DDS data', () => {
    const d = writeDds(image)
    d.writeUInt32LE(0x4 | 0x1, 80) // DDPF_FOURCC
    d.write('DXT5', 84, 'ascii')
    d.writeUInt32LE(d.readUInt32LE(8) | 0x20000, 8)
    d.writeUInt32LE(3, 28)
    expect(readDdsHeader(d)).toEqual({ width: 4, height: 2, mipMaps: 3, format: 'DXT5' })
    expect(() => readDdsBgra8(d)).toThrow('DXT5')
    expect(() => readDdsHeader(Buffer.alloc(128))).toThrow('not a DDS')
  })
})

describe('asset store', () => {
  const { png, hash, image } = syntheticPng(8, 8)

  it('stores a PNG under assets/<hash>.png and decodes it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-assets-'))
    const s = createAssetStore(dir)
    expect(s.has(hash)).toBe(false)
    await s.put(hash, png)
    expect(readFileSync(join(dir, 'assets', `${hash}.png`))).toEqual(png)
    expect(s.get(hash)).toEqual(image)
    const fresh = createAssetStore(dir) // the next session reads it from disk
    expect(fresh.has(hash)).toBe(true)
    expect(fresh.get(hash)).toEqual(image)
    expect(fresh.png(hash)).toEqual(png)
  })

  it('without a project keeps assets in memory', async () => {
    const s = createAssetStore()
    await s.put(hash, png)
    expect(s.has(hash)).toBe(true)
    expect(s.get(hash)?.width).toBe(8)
  })

  it('refuses a hash that is not 40 hex digits (it becomes a file name) and bytes that are not a readable PNG', async () => {
    const s = createAssetStore(mkdtempSync(join(tmpdir(), 'inkwell-assets-')))
    await expect(s.put('../../evil', png)).rejects.toThrow('not an image hash')
    await expect(s.put(hash, Buffer.from('nope'))).rejects.toThrow('not a PNG')
    expect(s.has(hash)).toBe(false)
    expect(s.get('../x')).toBeUndefined()
    expect(isAssetHash(hash)).toBe(true)
    expect(isAssetHash(hash.toUpperCase())).toBe(false)
  })

  it('DDS path: textures/Inkwell/<mod>/<hash>.dds, never from a bad hash', () => {
    expect(ddsRel('MyMod', hash)).toBe(`textures/Inkwell/MyMod/${hash}.dds`)
    expect(() => ddsRel('MyMod', '..\\x')).toThrow()
  })

  it('encodePng output is small for the synthetic images (no binaries committed; they are generated)', () => {
    expect(encodePng(syntheticPng(256, 256).image).length).toBeLessThan(20_000)
  })
})
