import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSettings, patchSettings, resolveSettings, saveSettings, validateSettings } from './settings'

describe('settings', () => {
  it('validates: unknown keys, wrong types and empty strings are dropped', () => {
    expect(validateSettings({ ffdecDir: ' C:\\F ', javaPath: 5, nope: 'x', papyrusExe: '', mo2ModName: 'Mod' })).toEqual({ ffdecDir: 'C:\\F', mo2ModName: 'Mod' })
    expect(validateSettings('x')).toEqual({})
    expect(validateSettings({ doctorSeen: true })).toEqual({ doctorSeen: true })
    expect(validateSettings({ doctorSeen: 'yes' })).toEqual({})
    expect(validateSettings({ deployConfirmed: { a: ['t', 3] } })).toEqual({ deployConfirmed: { a: ['t'] } })
  })
  it('defaults, stored values, and env overrides (with sources)', () => {
    const d = resolveSettings({}, {})
    expect(d).toMatchObject({ ffdecDir: 'C:\\Program Files (x86)\\FFDec', javaPath: 'java' })
    expect(d.papyrusExe).toBeUndefined()
    const r = resolveSettings({ ffdecDir: 'D:\\ff', papyrusExe: 'D:\\p.exe' }, { INKWELL_FFDEC: 'E:\\env', INKWELL_JAVA: 'j' })
    expect(r).toMatchObject({ ffdecDir: 'E:\\env', javaPath: 'j', papyrusExe: 'D:\\p.exe' })
    expect(r.source).toMatchObject({ ffdecDir: 'env', javaPath: 'env', papyrusExe: 'settings' })
  })
  it('patch sets and removes keys', () => {
    expect(patchSettings({ mo2ModName: 'A', skyrimPath: 'S' }, { mo2ModName: null, ffdecDir: 'F' })).toEqual({ skyrimPath: 'S', ffdecDir: 'F' })
  })
  it('round-trips through disk; a damaged file is empty settings', async () => {
    const d = mkdtempSync(join(tmpdir(), 'inkwell-set-'))
    const f = join(d, 'sub', 'settings.json')
    await saveSettings(f, { ffdecDir: 'X', deployConfirmed: { p: ['t'] } })
    expect(await loadSettings(f)).toEqual({ ffdecDir: 'X', deployConfirmed: { p: ['t'] } })
    writeFileSync(join(d, 'bad.json'), '{nope')
    expect(await loadSettings(join(d, 'bad.json'))).toEqual({})
    expect(await loadSettings(join(d, 'missing.json'))).toEqual({})
  })
})
