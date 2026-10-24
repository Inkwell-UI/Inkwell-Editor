import { crc32, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readZipEntry } from '../doctor/zip'
import { writeZip } from './zip'

const files = [
  { name: 'Scripts/b.pex', data: Buffer.alloc(4096, 7) }, // compressible: deflated
  { name: 'Interface/exported/widgets/M/Hud.swf', data: Buffer.from('FWS\u0008') }, // tiny: stored
  { name: 'Interface/Ünïcode ✓.swf', data: Buffer.from('hello') },
  { name: 'empty.txt', data: Buffer.alloc(0) }
]

/** Central directory records, parsed independently of the reader under test. */
function central(z: Buffer): { name: string; method: number; flags: number; crc: number; csize: number; size: number; local: number; date: number }[] {
  const eocd = z.length - 22
  expect(z.readUInt32LE(eocd)).toBe(0x06054b50)
  const out = []
  let p = z.readUInt32LE(eocd + 16)
  for (let n = z.readUInt16LE(eocd + 10); n > 0; n--) {
    expect(z.readUInt32LE(p)).toBe(0x02014b50)
    const nameLen = z.readUInt16LE(p + 28)
    out.push({ flags: z.readUInt16LE(p + 8), method: z.readUInt16LE(p + 10), date: z.readUInt16LE(p + 14), crc: z.readUInt32LE(p + 16), csize: z.readUInt32LE(p + 20), size: z.readUInt32LE(p + 24), local: z.readUInt32LE(p + 42), name: z.toString('utf8', p + 46, p + 46 + nameLen) })
    p += 46 + nameLen
  }
  return out
}

describe('writeZip', () => {
  it('CRC-32 is the standard one', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('round-trips through the doctor zip reader and through inflateRaw, with correct CRCs and sizes', () => {
    const z = writeZip(files)
    for (const f of files) expect(readZipEntry(z, f.name)).toEqual(f.data)
    const cd = central(z)
    expect(cd.map((e) => e.name)).toEqual([...files.map((f) => f.name)].sort()) // deterministic order
    for (const e of cd) {
      const f = files.find((x) => x.name === e.name)!
      expect(e.flags & 0x800).toBe(0x800) // UTF-8 names
      expect(e.size).toBe(f.data.length)
      expect(e.crc).toBe(crc32(f.data))
      const start = e.local + 30 + z.readUInt16LE(e.local + 26) + z.readUInt16LE(e.local + 28)
      const body = z.subarray(start, start + e.csize)
      expect(e.method === 8 ? inflateRawSync(body) : body).toEqual(f.data)
      expect(z.readUInt32LE(e.local + 14)).toBe(e.crc) // the local header agrees
    }
    expect(cd.find((e) => e.name === 'Scripts/b.pex')!.method).toBe(8)
    expect(cd.find((e) => e.name.endsWith('Hud.swf'))!.method).toBe(0)
  })

  it('is deterministic: the same files in any order give the same bytes', () => {
    expect(writeZip([...files].reverse()).equals(writeZip(files))).toBe(true)
  })

  it('refuses names that could leave the extraction folder', () => {
    for (const name of ['../x', '/abs', 'a\\b', '']) expect(() => writeZip([{ name, data: Buffer.from('x') }])).toThrow()
  })
})
