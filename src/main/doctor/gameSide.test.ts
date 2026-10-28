// The Doctor's game-side rows (0.5 Phase 7): SKSE64, Address Library, Inkwell Runtime and SkyUI, looked up in the MO2 mods directory and the game folder. Pure file lookups on temp folders.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSettings } from '../settings'
import { checkAddressLibrary, checkRuntime, checkSkse, checkSkyUi, figmaManifestPath, modFiles, type DoctorContext } from './checks'

const root = mkdtempSync(join(tmpdir(), 'inkwell-gameside-'))
let n = 0
const fresh = (): string => {
  const d = join(root, `case${n++}`)
  mkdirSync(d, { recursive: true })
  return d
}
const touch = (...p: string[]): void => {
  mkdirSync(join(...p.slice(0, -1)), { recursive: true })
  writeFileSync(join(...p), 'x')
}
const ctx = (mods?: string, exec?: DoctorContext['exec']): DoctorContext => ({
  settings: resolveSettings({}, mods ? { INKWELL_MO2_MODS: mods } : {}), appPath: resolve(__dirname, '../../..'), userData: fresh(), pluginConnections: 0, ...(exec ? { exec } : {})
})

describe('modFiles', () => {
  it('finds files one level down in each mod folder, case-insensitively by the given pattern', async () => {
    const mods = fresh()
    touch(mods, 'A', 'SKSE', 'Plugins', 'Inkwell.dll')
    touch(mods, 'B', 'SKSE', 'Plugins', 'other.dll')
    touch(mods, 'C', 'skse', 'plugins', 'inkwell.dll') // folder case: Windows is case-insensitive; the readdir path resolves it
    const hits = await modFiles(mods, 'SKSE/Plugins', /^Inkwell\.dll$/i)
    expect(hits.map((h) => h.mod).sort()).toEqual(['A', 'C'])
    expect(await modFiles(join(mods, 'nope'), 'SKSE/Plugins', /./)).toEqual([])
  })
})

describe('SKSE64', () => {
  it('passes with skse64_loader.exe in the game folder, fails without, is skipped without a Skyrim install', async () => {
    const game = fresh()
    expect((await checkSkse(ctx(), game)).status).toBe('fail')
    touch(game, 'skse64_loader.exe')
    expect(await checkSkse(ctx(), game)).toMatchObject({ id: 'skse', status: 'pass' })
    expect((await checkSkse(ctx(), undefined)).status).toBe('skipped')
  })
})

describe('Address Library', () => {
  it('finds versionlib-*.bin in a mod or in the game Data folder; warns with a link when neither has it', async () => {
    const mods = fresh()
    const game = fresh()
    expect(await checkAddressLibrary(ctx(mods), game)).toMatchObject({ status: 'warn', fix: { action: { kind: 'open' } } })
    touch(mods, 'Address Library for SKSE Plugins', 'SKSE', 'Plugins', 'versionlib-1-7-104-0.bin')
    expect(await checkAddressLibrary(ctx(mods), game)).toMatchObject({ status: 'pass', detail: expect.stringContaining('Address Library for SKSE Plugins') })
    const other = fresh()
    touch(game, 'Data', 'SKSE', 'Plugins', 'versionlib-1-5-97-0.bin')
    expect((await checkAddressLibrary(ctx(other), game)).status).toBe('pass')
    expect((await checkAddressLibrary(ctx(), undefined)).status).toBe('skipped')
  })
})

describe('Inkwell Runtime', () => {
  it('warns when no mod has Inkwell.dll, says where the zip has it; passes with the version and notes several copies', async () => {
    const mods = fresh()
    const exec = async (): Promise<string> => '0.4.0.0\n'
    expect(await checkRuntime(ctx(mods, exec))).toMatchObject({ id: 'runtime', status: 'warn', detail: expect.stringContaining('Inkwell-Runtime') })
    touch(mods, 'Runtime', 'SKSE', 'Plugins', 'Inkwell.dll')
    const one = await checkRuntime(ctx(mods, exec))
    expect(one.status).toBe('pass')
    expect(one.detail).toContain('Inkwell.dll 0.4.0.0')
    touch(mods, 'Spike', 'SKSE', 'Plugins', 'Inkwell.dll')
    expect((await checkRuntime(ctx(mods, exec))).detail).toContain('2 copies exist')
    expect((await checkRuntime(ctx())).status).toBe('skipped')
  })
})

describe('SkyUI', () => {
  it('names the mod that has SkyUI_SE.esp; not finding it is fine (skipped), and a missing mods directory is skipped too', async () => {
    const mods = fresh()
    expect(await checkSkyUi(ctx(mods))).toMatchObject({ id: 'skyui', status: 'skipped', detail: expect.stringContaining('fine') })
    touch(mods, 'SkyUI 5.2', 'SkyUI_SE.esp')
    expect(await checkSkyUi(ctx(mods))).toMatchObject({ status: 'pass', detail: expect.stringContaining('"SkyUI 5.2"') })
    expect((await checkSkyUi(ctx())).status).toBe('skipped')
  })
})

describe('Figma plugin manifest path', () => {
  it('prefers the portable zip layout (Inkwell-Figma-Plugin next to Inkwell.exe), else the sibling checkout, and a setting wins', () => {
    const zip = fresh()
    const appPath = join(zip, 'resources', 'app')
    mkdirSync(appPath, { recursive: true })
    const c = (setting?: string): DoctorContext => ({ settings: resolveSettings({}, setting ? { INKWELL_FIGMA_MANIFEST: setting } : {}), appPath, userData: fresh(), pluginConnections: 0 })
    expect(figmaManifestPath(c())).toBe(resolve(appPath, '..', 'Inkwell-Figma', 'plugin', 'manifest.json'))
    touch(zip, 'Inkwell-Figma-Plugin', 'manifest.json')
    expect(figmaManifestPath(c())).toBe(join(zip, 'Inkwell-Figma-Plugin', 'manifest.json'))
    expect(figmaManifestPath(c('X:\mine\manifest.json'))).toBe('X:\mine\manifest.json')
  })
})
