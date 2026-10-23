import { describe, expect, it } from 'vitest'
import { buildEsp, ESL_FLAG, MASTER, QUEST_FORM_ID } from './esp'

interface Rec { type: string; flags: number; formId: number; version: number; subs: { type: string; data: Buffer }[] }

/** Test-only reader that insists on consuming every byte. */
function parse(buf: Buffer): { tes4: Rec; grup: { label: string; records: Rec[] } } {
  const record = (p: number): { r: Rec; end: number } => {
    const size = buf.readUInt32LE(p + 4)
    const subs: Rec['subs'] = []
    let q = p + 24
    while (q < p + 24 + size) {
      const n = buf.readUInt16LE(q + 4)
      subs.push({ type: buf.toString('latin1', q, q + 4), data: buf.subarray(q + 6, q + 6 + n) })
      q += 6 + n
    }
    expect(q).toBe(p + 24 + size)
    return { r: { type: buf.toString('latin1', p, p + 4), flags: buf.readUInt32LE(p + 8), formId: buf.readUInt32LE(p + 12), version: buf.readUInt16LE(p + 20), subs }, end: q }
  }
  const t = record(0)
  const gp = t.end
  expect(buf.toString('latin1', gp, gp + 4)).toBe('GRUP')
  const q = record(gp + 24)
  expect(gp + buf.readUInt32LE(gp + 4)).toBe(buf.length) // group size covers the rest of the file
  expect(q.end).toBe(buf.length) // no stray bytes
  return { tes4: t.r, grup: { label: buf.toString('latin1', gp + 8, gp + 12), records: [q.r] } }
}

describe('buildEsp', () => {
  const buf = buildEsp({ questEdid: 'Mod_HudQuest', scriptName: 'Mod_HudInstance' })
  const { tes4, grup } = parse(buf)
  const sub = (r: Rec, t: string): Buffer => r.subs.find((s) => s.type === t)!.data

  it('TES4 header: ESL flag, version 1.71, one record, SkyUI as the only master', () => {
    expect(tes4.type).toBe('TES4')
    expect(tes4.flags).toBe(ESL_FLAG)
    expect(ESL_FLAG).toBe(0x200)
    expect(tes4.version).toBe(44)
    expect(tes4.subs.map((s) => s.type)).toEqual(['HEDR', 'CNAM', 'MAST', 'DATA'])
    const hedr = sub(tes4, 'HEDR')
    expect(hedr.readFloatLE(0)).toBeCloseTo(1.71)
    expect(hedr.readUInt32LE(4)).toBe(1)
    expect(hedr.readUInt32LE(8)).toBe(0x801)
    expect(MASTER).toBe('SkyUI_SE.esp')
    expect(sub(tes4, 'MAST').equals(Buffer.from(MASTER + '\0'))).toBe(true)
    expect(sub(tes4, 'DATA')).toEqual(Buffer.alloc(8))
  })

  it('one QUST in an ESL-legal form id, start-game-enabled, named after the widget', () => {
    expect(grup.label).toBe('QUST')
    const q = grup.records[0]!
    expect(q.type).toBe('QUST')
    expect(q.formId).toBe(QUEST_FORM_ID)
    expect(q.formId >>> 24).toBe(1) // index of this file, after the single master
    expect(q.formId & 0xffffff).toBeGreaterThanOrEqual(0x800)
    expect(sub(q, 'EDID').equals(Buffer.from('Mod_HudQuest\0'))).toBe(true)
    expect(sub(q, 'DNAM').readUInt16LE(0) & 1).toBe(1)
  })

  it('VMAD attaches exactly the Instance script, with no properties, fragments or aliases', () => {
    const v = sub(grup.records[0]!, 'VMAD')
    const name = 'Mod_HudInstance'
    const expected = Buffer.concat([
      Buffer.from([5, 0, 2, 0, 1, 0]), // version 5, object format 2, one script
      Buffer.from([name.length, 0]), Buffer.from(name), // script name
      Buffer.from([0, 0, 0]), // status, property count 0
      Buffer.from([2, 0, 0, 0, 0, 0, 0]) // fragment marker 2, 0 fragments, empty file name, 0 aliases
    ])
    expect(v.equals(expected)).toBe(true)
  })

  it('is deterministic', () => expect(buildEsp({ questEdid: 'Mod_HudQuest', scriptName: 'Mod_HudInstance' }).equals(buf)).toBe(true))
})
