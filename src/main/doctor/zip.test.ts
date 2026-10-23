import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readZipEntry } from './zip'

/** A minimal zip with a stored and a deflated entry (CRCs left 0: the reader does not check them). */
function zip(entries: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = []
  const cds: Buffer[] = []
  let off = 0
  for (const e of entries) {
    const body = e.deflate ? deflateRawSync(e.data) : e.data
    const nm = Buffer.from(e.name)
    const l = Buffer.alloc(30)
    l.writeUInt32LE(0x04034b50, 0)
    l.writeUInt16LE(e.deflate ? 8 : 0, 8)
    l.writeUInt32LE(body.length, 18)
    l.writeUInt32LE(e.data.length, 22)
    l.writeUInt16LE(nm.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(e.deflate ? 8 : 0, 10)
    c.writeUInt32LE(body.length, 20)
    c.writeUInt32LE(e.data.length, 24)
    c.writeUInt16LE(nm.length, 28)
    c.writeUInt32LE(off, 42)
    locals.push(l, nm, body)
    cds.push(c, nm)
    off += 30 + nm.length + body.length
  }
  const cd = Buffer.concat(cds)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, end])
}

describe('readZipEntry', () => {
  const z = zip([{ name: 'a.txt', data: Buffer.from('stored') }, { name: 'dir/project.properties', data: Buffer.from('version=26.3.0\n'.repeat(5)), deflate: true }])
  it('reads stored and deflated entries', () => {
    expect(readZipEntry(z, 'a.txt')?.toString()).toBe('stored')
    expect(readZipEntry(z, 'dir/project.properties')?.toString()).toContain('version=26.3.0')
  })
  it('missing entry and non-zip give undefined', () => {
    expect(readZipEntry(z, 'nope')).toBeUndefined()
    expect(readZipEntry(Buffer.from('not a zip at all, really not'), 'a')).toBeUndefined()
  })
})
