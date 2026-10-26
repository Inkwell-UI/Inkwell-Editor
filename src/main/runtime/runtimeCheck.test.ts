import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packVersion, RUNTIME_MESSAGES, RUNTIME_PLUGIN_NAME } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { buildPlayerAliasEsp, NO_MASTER_QUEST_FORM_ID, PLAYER_REF } from '../widget/esp'
import { compileRuntimeCheck, generateRuntimeCheckScript, runtimeCheckNames } from './runtimeCheck'

const papyrusExe = process.env['INKWELL_PAPYRUS'] && existsSync(process.env['INKWELL_PAPYRUS']) ? process.env['INKWELL_PAPYRUS'] : undefined

/** Evaluates the string expression of one `Debug.MessageBox(...)` line with the script's own properties. */
function messageOf(source: string, branch: number, vars: Record<string, string | number>): string {
  const lines = source.split('\n').filter((l) => l.includes('Debug.MessageBox('))
  const arg = lines[branch]!.replace(/^.*Debug\.MessageBox\((.*)\)\s*$/, '$1')
  return [...arg.matchAll(/"((?:[^"\\]|\\.)*)"|(\w+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : String(vars[m[2]!]))).join('')
}

describe('runtime check script (S3)', () => {
  const s = generateRuntimeCheckScript({ modId: 'MyMod', modName: 'My "Mod"', minRuntime: '0.3.0' })
  it('is named after the mod id, declares the packed minimum and asks SKSE for the Inkwell plugin', () => {
    expect(s.name).toBe('MyMod_RuntimeCheck')
    expect(s.source).toContain('Scriptname MyMod_RuntimeCheck extends ReferenceAlias')
    expect(s.source).toContain(`Int Property RequiredPacked = ${packVersion('0.3.0')} AutoReadOnly`)
    expect(s.source).toContain('196608')
    expect(s.source).toContain(`SKSE.GetPluginVersion("${RUNTIME_PLUGIN_NAME}")`)
    expect(s.source).toContain('Event OnInit()')
    expect(s.source).toContain('Event OnPlayerLoadGame()')
    expect(s.source).not.toMatch(/Inkwell_API/) // it must work without the runtime's scripts
  })
  it('shows exactly the texts of RUNTIME_MESSAGES', () => {
    const have = { major: 250, minor: 251, patch: 252 }
    const v = { ModName: 'My "Mod"', RequiredText: '0.3.0', RequiredMajor: 0, HaveText: '250.251.252' }
    expect(messageOf(s.source, 0, v)).toBe(RUNTIME_MESSAGES.notInstalled('My "Mod"', '0.3.0'))
    expect(messageOf(s.source, 1, v)).toBe(RUNTIME_MESSAGES.majorMismatch('My "Mod"', '0.3.0', 0, have))
    expect(messageOf(s.source, 2, v)).toBe(RUNTIME_MESSAGES.outdated('My "Mod"', '0.3.0', have))
  })
  it('the minimum follows the argument and hostile names cannot break the source', () => {
    const t = generateRuntimeCheckScript({ modId: 'M', modName: 'Evil"\n; Event Xé中', minRuntime: '1.12.300' })
    expect(t.source).toContain(`= ${packVersion('1.12.300')} AutoReadOnly`)
    expect(t.source).toContain('String Property ModName = "Evil\\"?; Event X?"')
    expect(() => generateRuntimeCheckScript({ modId: 'bad id', modName: 'x', minRuntime: '0.3.0' })).toThrow(/valid Papyrus name/)
    expect(() => generateRuntimeCheckScript({ modId: 'M', modName: 'x', minRuntime: '300.1.1' })).toThrow(/not a runtime version/)
  })
  it('two mods get different file, script and quest names', () => {
    const a = runtimeCheckNames('ModA'), b = runtimeCheckNames('ModB')
    for (const k of ['esp', 'script', 'quest', 'pex', 'psc'] as const) expect(a[k]).not.toBe(b[k])
  })
})

interface Rec { type: string; flags: number; formId: number; subs: { type: string; data: Buffer }[] }
/** Test-only reader: consumes every byte (TES4, then one QUST group with one record). */
function parse(buf: Buffer): { tes4: Rec; quest: Rec } {
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
    return { r: { type: buf.toString('latin1', p, p + 4), flags: buf.readUInt32LE(p + 8), formId: buf.readUInt32LE(p + 12), subs }, end: q }
  }
  const t = record(0)
  expect(buf.toString('latin1', t.end, t.end + 4)).toBe('GRUP')
  expect(t.end + buf.readUInt32LE(t.end + 4)).toBe(buf.length)
  const q = record(t.end + 24)
  expect(q.end).toBe(buf.length)
  return { tes4: t.r, quest: q.r }
}

describe('buildPlayerAliasEsp', () => {
  const o = { questEdid: 'M_RuntimeCheckQuest', aliasName: 'Player', aliasScript: 'M_RuntimeCheck' }
  const buf = buildPlayerAliasEsp(o)
  const { tes4, quest } = parse(buf)
  const sub = (r: Rec, t: string): Buffer => r.subs.find((x) => x.type === t)!.data
  it('has no master, is ESL-flagged and uses the file-local form id range', () => {
    expect(tes4.flags).toBe(0x200)
    expect(tes4.subs.map((x) => x.type)).toEqual(['HEDR', 'CNAM']) // no MAST, no DATA
    expect(quest.formId).toBe(NO_MASTER_QUEST_FORM_ID)
    expect(quest.formId >>> 24).toBe(0)
    expect(quest.formId & 0xffffff).toBeGreaterThanOrEqual(0x800)
    expect(sub(quest, 'DNAM').readUInt16LE(0) & 1).toBe(1) // start game enabled
  })
  it('one alias forced to the player, with the script attached to the alias (not the quest)', () => {
    expect(quest.subs.map((x) => x.type)).toEqual(['EDID', 'VMAD', 'DNAM', 'ANAM', 'ALST', 'ALID', 'FNAM', 'ALFR', 'VTCK', 'ALED'])
    expect(sub(quest, 'ANAM').readUInt32LE(0)).toBe(1)
    expect(sub(quest, 'ALFR').readUInt32LE(0)).toBe(PLAYER_REF)
    const name = 'M_RuntimeCheck'
    const expected = Buffer.concat([
      Buffer.from([5, 0, 2, 0, 0, 0]), // version 5, object format 2, no quest script
      Buffer.from([2, 0, 0, 0, 0, 1, 0]), // fragment marker, 0 fragments, empty file name, ONE alias
      Buffer.from([0, 0, 0, 0, 0x00, 0x08, 0, 0]), // object: unused u16, alias id 0, quest form id 0x800
      Buffer.from([5, 0, 2, 0, 1, 0]), Buffer.from([name.length, 0]), Buffer.from(name), Buffer.from([0, 0, 0]) // alias script, status 0, no properties
    ])
    expect(sub(quest, 'VMAD').equals(expected)).toBe(true)
  })
  it('is deterministic', () => expect(buildPlayerAliasEsp(o).equals(buf)).toBe(true))
})

describe.skipIf(!papyrusExe)('compileRuntimeCheck (needs INKWELL_PAPYRUS)', () => {
  it('compiles with the stubs and produces source, script and plugin', async () => {
    const r = await compileRuntimeCheck({ modId: 'MyMod', modName: 'My Mod', minRuntime: '0.3.0', papyrusExe: papyrusExe!, buildDir: mkdtempSync(join(tmpdir(), 'inkwell-rc-')) })
    expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
    expect(Object.keys(r.files).sort()).toEqual(['MyMod_RuntimeCheck.esp', 'Scripts/MyMod_RuntimeCheck.pex', 'Source/Scripts/MyMod_RuntimeCheck.psc'])
    const pex = r.files['Scripts/MyMod_RuntimeCheck.pex']!
    expect(pex.readUInt32BE(0)).toBe(0xfa57c0de)
    expect(pex.includes(Buffer.from('GetPluginVersion'))).toBe(true)
    expect(pex.includes(Buffer.from('Inkwell'))).toBe(true)
  })
  it('a compile error comes back as lint and yields no plugin', async () => {
    const r = await compileRuntimeCheck({ modId: 'MyMod', modName: 'x', minRuntime: '0.3.0', papyrusExe: papyrusExe!, stubsDir: mkdtempSync(join(tmpdir(), 'inkwell-nostubs-')), buildDir: mkdtempSync(join(tmpdir(), 'inkwell-rc-')) })
    expect(r.lint.some((l) => l.severity === 'error')).toBe(true)
    expect(Object.keys(r.files)).toEqual(['Source/Scripts/MyMod_RuntimeCheck.psc'])
  })
})
