// Dev deploy (docs/dev-mode.md, SPEC-CHANGES S6/O5): the dev INI and the dev SWF are written only when the toggle is on and the target is a folder; Package Mod and the Vortex zip never get them.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseIni, type Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { readZipEntry } from '../doctor/zip'
import { frame } from '../swf/ir.testutil'
import { RUNTIME_INI_REL } from '../runtime/devIni'
import { planDeploy } from './plan'
import type { DeploySwf } from './run'
import { createDeployService } from './service'
import { MANIFEST_NAME } from './write'

const appRoot = resolve(__dirname, '../../..')
const papyrusExe = process.env['INKWELL_PAPYRUS'] && existsSync(process.env['INKWELL_PAPYRUS']) ? process.env['INKWELL_PAPYRUS'] : undefined
const TOKEN = '5a'.repeat(32)
const INI = join('SKSE', 'Plugins', 'Inkwell', 'Inkwell.ini')

function setup(initial: boolean) {
  let devOn = initial
  const tmp = mkdtempSync(join(tmpdir(), 'inkwell-dev-'))
  const dir = join(tmp, 'project')
  mkdirSync(join(dir, 'build'), { recursive: true })
  writeFileSync(join(dir, 'build', 'wheel.swf'), 'FWS-game')
  writeFileSync(join(dir, 'build', 'wheel.dev.swf'), 'FWS-dev')
  const swf: DeploySwf = { name: 'wheel', orphaned: false, kind: 'customMenu', ir: { root: 'r', nodes: { r: frame('r', []) } } as unknown as Swf, build: { state: 'done', lint: [] } }
  const mods = join(tmp, 'mods')
  let ensured = 0
  const svc = createDeployService({
    userData: join(tmp, 'userData'), appPath: appRoot,
    project: () => ({ dir, name: 'Test', version: '1.0.0', modId: 'T', swfs: [swf] }),
    settings: () => ({ stored: {}, resolved: { ffdecDir: '', javaPath: '', source: {}, mo2ModsDir: mods, ...(papyrusExe ? { papyrusExe } : {}) } }),
    saveStored: async () => undefined,
    ffdec: () => ({ build: () => Promise.reject(new Error('unused')) }),
    report: () => undefined,
    chooseZip: async () => join(tmp, 'out.zip'),
    dev: () => (devOn ? { token: TOKEN, port: 8790 } : undefined),
    ensureDevBuilds: async () => void ensured++
  })
  return { svc, root: join(mods, 'Test'), tmp, ensured: () => ensured, setDev: (b: boolean) => void (devOn = b) }
}
const deploy = async (s: ReturnType<typeof setup>, target: 'mo2Mod' | 'package' | 'vortex' = 'mo2Mod') => {
  const p = await s.svc.prepare(target, 'all')
  if (!p.ok) throw new Error(p.error)
  return { p, r: await s.svc.commit(p.token) }
}

describe('Dev deploy on', () => {
  it('ships the dev SWF and writes Inkwell.ini with DevMode=1, the token and the port; the INI is not in the manifest', async () => {
    const s = setup(true)
    const { p, r } = await deploy(s)
    expect(r.ok).toBe(true)
    expect(r.devMenus).toEqual(['T_Wheel'])
    expect(s.ensured()).toBe(1)
    expect(readFileSync(join(s.root, 'Interface', 'Inkwell', 'T', 'Wheel.swf'), 'utf8')).toBe('FWS-dev')
    const ini = parseIni(readFileSync(join(s.root, INI), 'utf8'), 'runtime').ini
    expect(ini.dev).toEqual({ devMode: true, port: 8790, token: TOKEN })
    expect(Object.keys(JSON.parse(readFileSync(join(s.root, MANIFEST_NAME), 'utf8')).files)).not.toContain(RUNTIME_INI_REL)
    expect(p.files.find((f) => f.rel === RUNTIME_INI_REL)).toMatchObject({ devIni: true })
    expect(p.notes.join(' ')).toMatch(/Dev deploy/)
    expect(JSON.stringify(p)).not.toContain(TOKEN) // the dialog never sees the token
  })
  it('merges into an existing Inkwell.ini and replaces its token; a later normal deploy leaves it alone', async () => {
    const s = setup(true)
    mkdirSync(join(s.root, 'SKSE', 'Plugins', 'Inkwell'), { recursive: true })
    writeFileSync(join(s.root, INI), `[Runtime]\nLogLevel=debug\n\n[Dev]\nDevMode=0\nWatch=0\nToken=${'f'.repeat(64)}\n`)
    await deploy(s)
    const ini = parseIni(readFileSync(join(s.root, INI), 'utf8'), 'runtime').ini
    expect(ini.runtime?.logLevel).toBe('debug')
    expect(ini.dev).toEqual({ devMode: true, watch: false, port: 8790, token: TOKEN })
    const before = readFileSync(join(s.root, INI), 'utf8')
    s.setDev(false)
    const { r } = await deploy(s)
    expect(r.ok).toBe(true)
    expect(readFileSync(join(s.root, INI), 'utf8')).toBe(before) // untouched: it is the user's and the runtime's file
    expect(readFileSync(join(s.root, 'Interface', 'Inkwell', 'T', 'Wheel.swf'), 'utf8')).toBe('FWS-game') // the SWF is the normal build again
  })
  it('a second Dev deploy with the same inputs changes nothing', async () => {
    const s = setup(true)
    await deploy(s)
    const { r } = await deploy(s)
    expect(r).toMatchObject({ ok: true, written: 0 })
  })
})

describe('Dev deploy off, or a zip target', () => {
  it('toggle off: the normal SWF, no Inkwell.ini, the dev build is not even requested', async () => {
    const s = setup(false)
    const { r } = await deploy(s)
    expect(r.devMenus).toBeUndefined()
    expect(s.ensured()).toBe(0)
    expect(readFileSync(join(s.root, 'Interface', 'Inkwell', 'T', 'Wheel.swf'), 'utf8')).toBe('FWS-game')
    expect(existsSync(join(s.root, INI))).toBe(false)
  })
  it.skipIf(!papyrusExe)('Package Mod and the Vortex zip never contain dev mode, the token or the dev SWF, even with the toggle on', async () => {
    for (const target of ['package', 'vortex'] as const) {
      const s = setup(true)
      const { r } = await deploy(s, target)
      expect(r.ok).toBe(true)
      expect(s.ensured()).toBe(0)
      const zip = readFileSync(r.zipPath!)
      expect(readZipEntry(zip, 'Interface/Inkwell/T/Wheel.swf')?.toString()).toBe('FWS-game')
      expect(readZipEntry(zip, RUNTIME_INI_REL)).toBeUndefined()
      expect(zip.includes(Buffer.from(TOKEN))).toBe(false)
      expect(zip.includes(Buffer.from('DevMode'))).toBe(false)
    }
  })
  it('the plan adds Inkwell.ini only for a custom menu', () => {
    const base = { modId: 'T', root: 'C:\\mods\\T', gameDirs: [], hasPapyrus: false, dev: true }
    const menu = planDeploy({ ...base, swfs: [{ name: 'wheel', orphaned: false, kind: 'customMenu' }] })
    expect(menu.files.map((f) => f.rel)).toContain(RUNTIME_INI_REL)
    const hud = planDeploy({ ...base, swfs: [{ name: 'hud', orphaned: false, kind: 'hudWidget' }] })
    expect(hud.files.map((f) => f.rel)).not.toContain(RUNTIME_INI_REL)
    expect(planDeploy({ ...base, dev: false, swfs: [{ name: 'wheel', orphaned: false, kind: 'customMenu' }] }).files.map((f) => f.rel)).not.toContain(RUNTIME_INI_REL)
  })
})
