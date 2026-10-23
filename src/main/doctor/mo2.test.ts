import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSettings } from '../settings'
import { checkMo2, type DoctorContext } from './checks'
import { runDoctor } from './index'

const root = mkdtempSync(join(tmpdir(), 'inkwell-mo2-'))
const dir = (...p: string[]): string => {
  mkdirSync(join(root, ...p), { recursive: true })
  return join(root, ...p)
}
const ctx = (env: NodeJS.ProcessEnv, stored: Parameters<typeof resolveSettings>[0] = {}): DoctorContext => ({
  settings: resolveSettings(stored, env), appPath: resolve(__dirname, '../../..'), userData: dir('ud'), pluginConnections: 0, projectName: 'My Widget'
})

describe('MO2 deploy check', () => {
  it('nothing set: warn with a Browse fix', async () => {
    const r = await checkMo2(ctx({}), [])
    expect(r).toMatchObject({ id: 'mo2', status: 'warn', fix: { action: { kind: 'browse', setting: 'mo2ModsDir' } } })
  })
  it('valid mods directory: pass, the default mod name is the project name, the temp file is gone', async () => {
    const mods = dir('mods-ok')
    const r = await checkMo2(ctx({ INKWELL_MO2_MODS: mods }), [])
    expect(r.status).toBe('pass')
    expect(r.detail).toContain(join(mods, 'My Widget'))
    expect(readdirSync(mods)).toEqual([]) // nothing left behind, and the mod folder is not created by a check
  })
  it('missing mods directory fails and says so', async () => {
    const r = await checkMo2(ctx({ INKWELL_MO2_MODS: join(root, 'nope') }), [])
    expect(r).toMatchObject({ status: 'fail', fix: { action: { kind: 'browse', setting: 'mo2ModsDir' } } })
    expect(r.detail).toMatch(/does not exist/)
  })
  it('a file instead of a folder fails', async () => {
    writeFileSync(join(root, 'file.txt'), 'x')
    const r = await checkMo2(ctx({ INKWELL_MO2_MODS: join(root, 'file.txt') }), [])
    expect(r.status).toBe('fail')
    expect(r.detail).toMatch(/is a file, not a folder/)
  })
  it('a mod folder that is a file fails', async () => {
    const mods = dir('mods-file')
    writeFileSync(join(mods, 'My Widget'), 'x')
    const r = await checkMo2(ctx({ INKWELL_MO2_MODS: mods }), [])
    expect(r.status).toBe('fail')
    expect(r.detail).toMatch(/Mod folder: .*is a file, not a folder/)
  })
  it('refuses targets inside the Skyrim Data folder (detected install, and by name)', async () => {
    const sky = dir('Games', 'Skyrim Special Edition')
    const inData = dir('Games', 'Skyrim Special Edition', 'Data', 'mods')
    const r = await checkMo2(ctx({ INKWELL_MO2_MODS: inData }), [sky])
    expect(r.status).toBe('fail')
    expect(r.detail).toMatch(/inside the game's Data folder/)
    const other = dir('elsewhere', 'Data')
    expect((await checkMo2(ctx({ INKWELL_MO2_MODS: other }), [resolve(other, '..')])).status).toBe('fail') // Data of a detected install with any name
    expect((await checkMo2(ctx({ INKWELL_MO2_MODS: other }), [])).status).toBe('pass') // not a game folder
  })
  it('an invalid mod name fails with a Clear fix; a path as name too', async () => {
    const mods = dir('mods-name')
    for (const name of ['a\\b', 'a/b', '..', 'x.', 'a:b']) {
      const r = await checkMo2(ctx({ INKWELL_MO2_MODS: mods }, { mo2ModName: name }), [])
      expect(r, name).toMatchObject({ status: 'fail', fix: { action: { kind: 'clear', setting: 'mo2ModName' } } })
    }
    const ok = await checkMo2(ctx({ INKWELL_MO2_MODS: mods }, { mo2ModName: 'Good Name' }), [])
    expect(ok.status).toBe('pass')
    expect(ok.detail).toContain('Good Name')
  })
  it('the overwrite folder is checked too, alone or with the mods directory', async () => {
    const over = dir('over')
    expect((await checkMo2(ctx({ INKWELL_MO2_OVERWRITE: over }), [])).status).toBe('pass')
    const bad = await checkMo2(ctx({ INKWELL_MO2_MODS: dir('mods-over'), INKWELL_MO2_OVERWRITE: join(root, 'gone') }), [])
    expect(bad.status).toBe('fail')
    expect(bad.detail).toMatch(/Overwrite folder: .*does not exist/)
    expect(bad.fix).toMatchObject({ action: { setting: 'mo2OverwriteDir' } })
  })
  // A truly unwritable folder cannot be made portably on Windows (the read-only attribute does not stop creating files in a folder), so the write
  // probe's failure path is covered with a folder below a file, which cannot exist or be written.
  it('a folder that cannot be created or written fails with the system reason', async () => {
    writeFileSync(join(root, 'blocker'), 'x')
    const r = await checkMo2(ctx({ INKWELL_MO2_OVERWRITE: join(root, 'blocker', 'x') }), [])
    expect(r.status).toBe('fail')
  })
})

describe('partial doctor runs', () => {
  it('runs only the requested checks, in display order', async () => {
    const c = ctx({ INKWELL_MO2_MODS: dir('mods-partial') })
    const r = await runDoctor({ ...c, exec: async () => Promise.reject(new Error('no')) }, ['mo2', 'java'])
    expect(r.map((x) => x.id)).toEqual(['java', 'mo2'])
    expect(await runDoctor(c, [])).toEqual([])
  })
})
