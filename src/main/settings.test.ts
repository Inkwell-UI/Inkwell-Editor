import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectSetting, loadSettings, modNameProblem, normalizeValue, patchSettings, refuseReason, resolveSettings, saveSettings, settingProblems, validateSettings } from './settings'

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

describe('settings edge cases (Setup Doctor bug)', () => {
  it('normalizes what a user pastes: quotes from "Copy as path", surrounding spaces; refuses line breaks and empty text', () => {
    expect(normalizeValue('  "C:\\Program Files\\Java\\bin\\java.exe"  ')).toBe('C:\\Program Files\\Java\\bin\\java.exe')
    expect(normalizeValue('"')).toBe('"')
    expect(normalizeValue('')).toBeUndefined()
    expect(normalizeValue('   ')).toBeUndefined()
    expect(normalizeValue('a\nb')).toBeUndefined()
    expect(normalizeValue(5)).toBeUndefined()
    expect(validateSettings({ ffdecDir: '"D:\\ff"' })).toEqual({ ffdecDir: 'D:\\ff' })
  })
  it('a refused value says why (it was silently dropped before)', () => {
    expect(refuseReason('javaPath', 'a\nb')).toMatch(/line breaks/)
    expect(refuseReason('mo2ModName', 'a\\b')).toMatch(/not a path/)
    expect(refuseReason('mo2ModsDir', 'D:\\mods')).toBeUndefined()
    expect(modNameProblem('Good Mod')).toBeUndefined()
    expect(modNameProblem('..')).toBeDefined()
    expect(modNameProblem('end.')).toBeDefined()
    expect(modNameProblem('a|b')).toBeDefined()
  })
  it('patch: removing an unset key is fine, unknown keys are ignored, an empty value removes the key', () => {
    expect(patchSettings({ skyrimPath: 'S' }, { mo2ModsDir: null })).toEqual({ skyrimPath: 'S' })
    expect(patchSettings({ skyrimPath: 'S' }, { nope: 'x' } as never)).toEqual({ skyrimPath: 'S' })
    expect(patchSettings({ skyrimPath: 'S' }, { skyrimPath: '' })).toEqual({})
    expect(patchSettings({}, { mo2ModsDir: ' "E:\\m" ' })).toEqual({ mo2ModsDir: 'E:\\m' })
  })
  it('an environment variable wins over the stored value and says so; an empty variable does not', () => {
    const r = resolveSettings({ papyrusExe: 'D:\\stored.exe' }, { INKWELL_PAPYRUS: 'E:\\env.exe' })
    expect(r.papyrusExe).toBe('E:\\env.exe')
    expect(r.source.papyrusExe).toBe('env')
    expect(resolveSettings({ papyrusExe: 'D:\\stored.exe' }, { INKWELL_PAPYRUS: '' }).source.papyrusExe).toBe('settings')
  })
  it('overlapping saves of one file all succeed and leave valid json and no temp files (the shared .tmp name used to race)', async () => {
    const d = mkdtempSync(join(tmpdir(), 'inkwell-race-'))
    const f = join(d, 'settings.json')
    await Promise.all(Array.from({ length: 25 }, (_, i) => saveSettings(f, { mo2ModName: `m${i}` })))
    expect((await loadSettings(f)).mo2ModName).toMatch(/^m\d+$/)
    expect(readdirSync(d)).toEqual(['settings.json'])
  })
  it('a failing write is thrown (not swallowed) and leaves no temp file', async () => {
    const d = mkdtempSync(join(tmpdir(), 'inkwell-fail-'))
    mkdirSync(join(d, 'settings.json')) // a folder where the file should go: rename onto it fails
    await expect(saveSettings(join(d, 'settings.json'), { mo2ModName: 'x' })).rejects.toBeTruthy()
    expect(readdirSync(d)).toEqual(['settings.json'])
  })
  it('inspectSetting: does not exist / file for folder / folder for file / not an executable / wrong kind of folder / fine', async () => {
    const d = mkdtempSync(join(tmpdir(), 'inkwell-insp-'))
    const sub = join(d, 'sub')
    mkdirSync(sub)
    writeFileSync(join(d, 'a.txt'), 'x')
    writeFileSync(join(d, 'p.exe'), 'x')
    writeFileSync(join(d, 'm.json'), '{}')
    expect(await inspectSetting('mo2ModsDir', join(d, 'nope'))).toMatch(/does not exist/)
    expect(await inspectSetting('mo2ModsDir', join(d, 'a.txt'))).toMatch(/is a file, not a folder/)
    expect(await inspectSetting('mo2ModsDir', sub)).toBeUndefined()
    expect(await inspectSetting('papyrusExe', sub)).toMatch(/is a folder, not a file/)
    expect(await inspectSetting('papyrusExe', join(d, 'a.txt'))).toMatch(/is not papyrus\.exe/)
    expect(await inspectSetting('papyrusExe', join(d, 'p.exe'))).toBeUndefined()
    expect(await inspectSetting('javaPath', 'java')).toBeUndefined() // looked up on PATH by the check
    expect(await inspectSetting('javaPath', join(d, 'a.txt'))).toMatch(/is not java\.exe/)
    expect(await inspectSetting('ffdecDir', sub)).toMatch(/no lib\\ffdec_lib\.jar/)
    expect(await inspectSetting('skyrimPath', sub)).toMatch(/no SkyrimSE\.exe/)
    mkdirSync(join(sub, 'lib'))
    writeFileSync(join(sub, 'lib', 'ffdec_lib.jar'), 'x')
    expect(await inspectSetting('ffdecDir', sub)).toBeUndefined()
    expect(await inspectSetting('figmaManifest', join(d, 'm.json'))).toBeUndefined()
    expect(await inspectSetting('figmaManifest', join(d, 'a.txt'))).toMatch(/is not the plugin manifest/)
    expect(await inspectSetting('mo2ModName', 'a/b')).toMatch(/not a path/)
  })
  it('settingProblems inspects explicit values only (stored or env), not defaults', async () => {
    const d = mkdtempSync(join(tmpdir(), 'inkwell-prob-'))
    const p = await settingProblems(resolveSettings({ mo2ModsDir: join(d, 'gone') }, { INKWELL_SKYRIM: join(d, 'gone2') }))
    expect(Object.keys(p).sort()).toEqual(['mo2ModsDir', 'skyrimPath'])
    expect(await settingProblems(resolveSettings({}, {}))).toEqual({})
  })
})

describe('figmaPlugins setting', () => {
  it('keeps only distinct 64-hex digests', () => {
    const h = 'a'.repeat(64)
    expect(validateSettings({ figmaPlugins: [h, h, 'short', 5, 'A'.repeat(64)] })).toEqual({ figmaPlugins: [h] })
    expect(validateSettings({ figmaPlugins: [] })).toEqual({})
  })
})
