// The export gate through the deploy service: prepare shows it, commit refuses a blocked deploy even when the renderer asks.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import type { DeployLintItem, DeployState } from '../../shared/deploy'
import { readZipEntry } from '../doctor/zip'
import { frame } from '../swf/ir.testutil'
import { sha256 } from '../vanilla/bsa'
import type { DeploySwf } from './run'
import { createDeployService } from './service'

function setup(lint: DeployLintItem[], strictMode = false, chooseZip?: (def: string) => Promise<string | undefined>) {
  const tmp = mkdtempSync(join(tmpdir(), 'inkwell-svc-'))
  const dir = join(tmp, 'project')
  mkdirSync(join(dir, 'build'), { recursive: true })
  writeFileSync(join(dir, 'build', 'wheel.swf'), 'FWS-mine')
  const swf: DeploySwf = { name: 'wheel', orphaned: false, kind: 'customMenu', ir: { root: 'r', nodes: { r: frame('r', []) } } as unknown as Swf, build: { state: 'done', lint } }
  const reports: DeployState[] = []
  const mods = join(tmp, 'mods')
  const svc = createDeployService({
    userData: join(tmp, 'userData'), appPath: tmp,
    project: () => ({ dir, name: 'Test', version: '1.2.0', modId: 'T', swfs: [swf], strictMode }),
    settings: () => ({ stored: {}, resolved: { ffdecDir: '', javaPath: '', source: {}, mo2ModsDir: mods } }),
    saveStored: async () => undefined,
    ffdec: () => ({ build: () => Promise.reject(new Error('unused')) }),
    report: (s) => void reports.push(s),
    ...(chooseZip ? { chooseZip } : {})
  })
  return { svc, root: join(mods, 'Test'), reports, tmp, dir }
}
const warn: DeployLintItem = { severity: 'warning', code: 'font-fallback', message: 'nearest alias', nodeId: '1:2', layerName: 'Title' }
const err: DeployLintItem = { severity: 'error', code: 'font-unmapped', message: 'no alias', nodeId: '1:3', layerName: 'Sub' }

describe('deploy service export gate', () => {
  it('a warning passes: listed in the gate, the commit writes', async () => {
    const { svc, root } = setup([warn])
    const p = await svc.prepare('mo2Mod', 'all')
    if (!p.ok) throw new Error(p.error)
    expect(p.gate).toMatchObject({ ok: true, blocking: [], warnings: [{ code: 'font-fallback', swf: 'wheel', nodeId: '1:2' }] })
    expect((await svc.commit(p.token)).ok).toBe(true)
    expect(existsSync(join(root, 'Interface', 'Inkwell', 'T', 'Wheel.swf'))).toBe(true)
    expect(existsSync(join(root, 'SKSE', 'Plugins', 'Inkwell', 'menus', 'T_Wheel.json'))).toBe(true)
    expect(existsSync(join(root, 'SKSE', 'Plugins', 'Inkwell', 'T.ini'))).toBe(true)
  })

  it('an error blocks: the dialog is forced, the commit is refused and nothing is written', async () => {
    const { svc, root, reports } = setup([err])
    const p = await svc.prepare('mo2Mod', 'all')
    if (!p.ok) throw new Error(p.error)
    expect(p).toMatchObject({ needsConfirm: true, gate: { ok: false, blocking: [{ code: 'font-unmapped', swf: 'wheel', nodeId: '1:3' }] } })
    expect(reports.at(-1)).toMatchObject({ state: 'error', message: expect.stringContaining('Deploy blocked: 1 lint error') })
    expect(await svc.commit(p.token)).toMatchObject({ ok: false, error: expect.stringContaining('Deploy blocked') })
    expect(existsSync(root)).toBe(false)
  })

  it('Strict Mode blocks a warning', async () => {
    const { svc, root } = setup([warn], true)
    const p = await svc.prepare('mo2Mod', 'all')
    if (!p.ok) throw new Error(p.error)
    expect(p.gate).toMatchObject({ ok: false, strict: true, blocking: [{ code: 'font-fallback', severity: 'error' }] })
    expect((await svc.commit(p.token)).ok).toBe(false)
    expect(existsSync(root)).toBe(false)
  })
})

describe('Package Mod (and the Vortex target): the deploy files as one zip', () => {
  const pkg = (lint: DeployLintItem[] = [], answer?: (tmp: string, def: string) => string | undefined, strict = false) => {
    const asked: string[] = []
    let tmpDir = ''
    const r = setup(lint, strict, async (def) => (asked.push(def), answer ? answer(tmpDir, def) : join(tmpDir, 'out', 'pick.zip')))
    tmpDir = r.tmp
    return { ...r, asked }
  }

  it('plans the same files as a deploy and writes them at the zip root; default <project>/dist/<Name>-<version>.zip', async () => {
    const { svc, root, asked, tmp, dir } = pkg([warn])
    const d = await svc.prepare('mo2Mod', 'all')
    const p = await svc.prepare('package', 'all')
    if (!d.ok || !p.ok) throw new Error('prepare failed')
    expect(p.files).toEqual(d.files)
    expect(p).toMatchObject({ needsConfirm: false, removed: [], root: join(dir, 'dist'), gate: { ok: true } })
    const r = await svc.commit(p.token)
    expect(r).toMatchObject({ ok: true, zipPath: join(tmp, 'out', 'pick.zip'), written: 3 })
    expect(asked).toEqual([join(dir, 'dist', 'Test-1.2.0.zip')])
    const zip = readFileSync(r.zipPath!)
    expect(readZipEntry(zip, 'Interface/Inkwell/T/Wheel.swf')?.toString()).toBe('FWS-mine')
    expect(JSON.parse(readZipEntry(zip, 'SKSE/Plugins/Inkwell/menus/T_Wheel.json')!.toString())).toMatchObject({ name: 'T_Wheel', swf: 'Interface/Inkwell/T/Wheel.swf' })
    expect(readZipEntry(zip, 'SKSE/Plugins/Inkwell/T.ini')?.toString()).toContain('[Menu.T_Wheel]') // the package carries the INI too (a fresh install has none)
    expect(readZipEntry(zip, 'Inkwell.ini')).toBeUndefined()
    expect(existsSync(root)).toBe(false) // the MO2 folder is not touched
    expect(existsSync(`${r.zipPath}.inkwell-tmp`)).toBe(false)
    // byte-identical on a second package of the same input
    const p2 = await svc.prepare('vortex', 'all')
    if (!p2.ok) throw new Error(p2.error)
    expect((await svc.commit(p2.token)).ok).toBe(true)
    expect(readFileSync(r.zipPath!).equals(zip)).toBe(true)
  })

  it('a blocked package (lint error, or a warning in Strict Mode) opens the dialog, writes nothing and never asks for a path', async () => {
    for (const [lint, strict] of [[[err], false], [[warn], true]] as const) {
      const { svc, asked, reports } = pkg([...lint], undefined, strict)
      const p = await svc.prepare('package', 'all')
      if (!p.ok) throw new Error(p.error)
      expect(p).toMatchObject({ needsConfirm: true, gate: { ok: false } })
      expect(reports.at(-1)?.message).toContain('Package blocked')
      expect(await svc.commit(p.token)).toMatchObject({ ok: false, error: expect.stringContaining('Package blocked') })
      expect(asked).toEqual([])
    }
  })

  it("refuses to save into a game Data folder; a cancelled dialog writes nothing", async () => {
    const data = pkg([], (tmp) => join(tmp, 'Skyrim Special Edition', 'Data', 'm.zip'))
    const p = await data.svc.prepare('package', 'all')
    if (!p.ok) throw new Error(p.error)
    expect(await data.svc.commit(p.token)).toMatchObject({ ok: false, error: expect.stringContaining('Data folder') })
    expect(existsSync(join(data.tmp, 'Skyrim Special Edition'))).toBe(false)
    const none = pkg([], () => undefined)
    const p2 = await none.svc.prepare('package', 'all')
    if (!p2.ok) throw new Error(p2.error)
    expect(await none.svc.commit(p2.token)).toEqual({ ok: false, cancelled: true })
  })

  it('refuses an unmodified vanilla SWF, like a deploy', async () => {
    const { svc, tmp, dir, asked } = pkg([])
    writeFileSync(join(dir, 'build', 'wheel.swf'), 'vanilla-bytes')
    mkdirSync(join(tmp, 'userData', 'vanilla-cache', 'x'), { recursive: true })
    writeFileSync(join(tmp, 'userData', 'vanilla-cache', 'x', 'index.json'), JSON.stringify({ entries: [{ sha256: sha256(Buffer.from('vanilla-bytes')) }] }))
    expect(await svc.prepare('package', 'all')).toMatchObject({ ok: false, error: expect.stringContaining('unmodified vanilla') })
    expect(asked).toEqual([])
  })
})
