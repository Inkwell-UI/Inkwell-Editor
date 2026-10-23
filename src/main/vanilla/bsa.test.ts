import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractEntry, openBsa, sha256, sha256File } from './bsa'
import { buildBsa } from './bsa.testutil'

const tmp = (name: string, data: Buffer): string => {
  const p = join(mkdtempSync(join(tmpdir(), 'inkwell-bsa-')), name)
  writeFileSync(p, data)
  return p
}
const big = Buffer.from('inkwell '.repeat(4000))

describe('bsa reader', () => {
  it('lists and extracts uncompressed entries', () => {
    const a = openBsa(tmp('a.bsa', buildBsa([{ folder: 'interface', name: 'a.swf', data: Buffer.from('FWS-a') }, { folder: 'interface\\x', name: 'b.txt', data: Buffer.from('bee') }])))
    expect(a.entries.map((e) => `${e.folder}/${e.name}`)).toEqual(['interface/a.swf', 'interface/x/b.txt'])
    expect(a.entries.every((e) => !e.compressed)).toBe(true)
    expect(extractEntry(a, a.entries[0]!).toString()).toBe('FWS-a')
    expect(extractEntry(a, a.entries[1]!).toString()).toBe('bee')
  })
  it('extracts a per-file compressed entry (flag toggles the archive default)', () => {
    const a = openBsa(tmp('c.bsa', buildBsa([{ folder: 'interface', name: 'big.swf', data: big, compress: true }, { folder: 'interface', name: 'small.swf', data: Buffer.from('s') }])))
    expect(a.entries.map((e) => e.compressed)).toEqual([true, false])
    expect(extractEntry(a, a.entries[0]!).equals(big)).toBe(true)
    expect(extractEntry(a, a.entries[1]!).toString()).toBe('s')
  })
  it('default-compressed archives with embedded names, and an entry opting out', () => {
    const a = openBsa(tmp('d.bsa', buildBsa([{ folder: 'f', name: 'one.bin', data: big }, { folder: 'f', name: 'two.bin', data: Buffer.from('raw'), compress: false }], { defaultCompressed: true, embedNames: true })))
    expect(a.entries.map((e) => e.compressed)).toEqual([true, false])
    expect(extractEntry(a, a.entries[0]!).equals(big)).toBe(true)
    expect(extractEntry(a, a.entries[1]!).toString()).toBe('raw')
  })
  it('rejects non-archives, other versions and truncated files', () => {
    expect(() => openBsa(tmp('x.bsa', Buffer.alloc(64)))).toThrow(/Not a BSA/)
    const v = buildBsa([{ folder: 'f', name: 'n', data: Buffer.from('x') }])
    v.writeUInt32LE(104, 4)
    expect(() => openBsa(tmp('v.bsa', v))).toThrow(/Unsupported BSA version 104/)
    expect(() => openBsa(tmp('t.bsa', v.subarray(0, 20)))).toThrow()
  })
  it('hashes a file by streaming (equals the in-memory hash)', async () => {
    const b = buildBsa([{ folder: 'f', name: 'n', data: big }])
    expect(await sha256File(tmp('h.bsa', b))).toBe(sha256(b))
  })
})
