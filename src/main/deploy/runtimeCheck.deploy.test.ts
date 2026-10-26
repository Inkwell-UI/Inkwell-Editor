// The runtime check in the deploy path (S3, O4): files written, mandatory in a package, warning in a folder deploy, hostile menu.json values, no collision with the widget plugin.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MENU_SLOTS, MENU_WARN_THRESHOLD, MenuSettings, type Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { exportGate } from '../lint/gate'
import { defaultMenuSettings, menuLint } from '../../shared/menu'
import { maxVersion, minRuntimeFor } from '../../shared/runtimeFeatures'
import { frame } from '../swf/ir.testutil'
import { planDeploy, projectMinRuntime, safeJoin, type SwfLike } from './plan'
import { commitDeploy, prepareDeploy, type DeployInput, type DeploySwf } from './run'
import { resolve } from 'node:path'

const papyrusExe = process.env['INKWELL_PAPYRUS'] && existsSync(process.env['INKWELL_PAPYRUS']) ? process.env['INKWELL_PAPYRUS'] : undefined
const stubsDir = resolve(__dirname, '../../../resources/papyrus-stubs')
const noFfdec = { build: () => Promise.reject(new Error('FFDec must not be used here')) }
const CHECK = ['Scripts/M_RuntimeCheck.pex', 'Source/Scripts/M_RuntimeCheck.psc', 'M_RuntimeCheck.esp']

const swf = (name: string, menu?: MenuSettings): DeploySwf => ({ name, orphaned: false, kind: 'customMenu', ir: { root: 'r', nodes: { r: frame('r', []) } } as unknown as Swf, build: { state: 'done', lint: [] }, ...(menu ? { menu } : {}) })
function input(over: Partial<DeployInput> = {}, ...names: string[]): DeployInput {
  const i: DeployInput = {
    modId: 'M', modName: 'My Mod', swfs: (names.length ? names : ['wheel']).map((n) => swf(n)), root: join(mkdtempSync(join(tmpdir(), 'inkwell-rc-')), 'mod'), gameDirs: [],
    buildDir: mkdtempSync(join(tmpdir(), 'inkwell-rcb-')), ffdec: noFfdec, vanillaHashes: new Set(), stubsDir, ...over
  }
  for (const s of i.swfs) writeFileSync(join(i.buildDir, `${s.name}.swf`), 'FWS-mine')
  return i
}

describe.skipIf(!papyrusExe)('a customMenu deploy with a Papyrus compiler', () => {
  it('writes the runtime check next to the menu files, with zero graphs; the JSON, the script and the dialog agree on the minimum', async () => {
    const i = input({ papyrusExe: papyrusExe! })
    const r = await prepareDeploy(i)
    if (!r.ok) throw new Error(r.error)
    expect([...r.prepared.files.keys()].sort()).toEqual(['Interface/Inkwell/M/Wheel.swf', 'SKSE/Plugins/Inkwell/menus/M_Wheel.json', 'SKSE/Plugins/Inkwell/M.ini', ...CHECK].sort())
    expect(exportGate(r.prepared.issues, false).ok).toBe(true)
    expect(r.prepared.plan.notes[0]).toBe('Requires Inkwell Runtime 0.3.0 or newer; not included in this deploy.')
    expect((await commitDeploy(i, r.prepared)).ok).toBe(true)
    for (const f of CHECK) expect(existsSync(join(i.root, ...f.split('/'))), f).toBe(true)
    expect(JSON.parse(readFileSync(join(i.root, 'SKSE/Plugins/Inkwell/menus/M_Wheel.json'), 'utf8')).minRuntime).toBe('0.3.0')
    expect(readFileSync(join(i.root, 'Source/Scripts/M_RuntimeCheck.psc'), 'utf8')).toContain('RequiredText = "0.3.0"')
    // a second deploy changes nothing; the plugin is part of the manifest (retired with the mod)
    const again = await prepareDeploy(i)
    if (!again.ok) throw new Error(again.error)
    expect((await commitDeploy(i, again.prepared)).written).toBe(0)
  })
  it('two menus share ONE check', async () => {
    const r = await prepareDeploy(input({ papyrusExe: papyrusExe! }, 'wheel', 'inventory'))
    if (!r.ok) throw new Error(r.error)
    expect([...r.prepared.files.keys()].filter((k) => k.includes('RuntimeCheck'))).toHaveLength(3)
  })
  it('a script that does not compile blocks the gate with the compiler message', async () => {
    const r = await prepareDeploy(input({ papyrusExe: papyrusExe!, stubsDir: mkdtempSync(join(tmpdir(), 'inkwell-nostubs-')) }))
    if (!r.ok) throw new Error(r.error)
    const g = exportGate(r.prepared.issues, false)
    expect(g.ok).toBe(false)
    expect(g.blocking[0]).toMatchObject({ code: 'papyrus-compile-failed', swf: 'wheel' })
    expect(g.blocking[0]!.message).toContain('M_RuntimeCheck.psc')
  })
})

describe('without a Papyrus compiler', () => {
  it('a folder deploy warns `runtime-check-missing` and says what to do; the deploy still works', async () => {
    const i = input()
    const r = await prepareDeploy(i)
    if (!r.ok) throw new Error(r.error)
    const row = r.prepared.issues.find((l) => l.code === 'runtime-check-missing')
    expect(row).toMatchObject({ severity: 'warning', swf: 'wheel' })
    expect(row!.message).toMatch(/Set the compiler path in Settings/)
    expect(exportGate(r.prepared.issues, false).ok).toBe(true)
    expect([...r.prepared.files.keys()].some((k) => k.includes('RuntimeCheck'))).toBe(false)
    expect((await commitDeploy(i, r.prepared)).ok).toBe(true)
    // Strict Mode promotes it like every warning
    expect(exportGate(r.prepared.issues, true).ok).toBe(false)
  })
  it('Package Mod / Vortex: an ERROR in the gate (the check is mandatory)', async () => {
    const r = await prepareDeploy(input({ package: true }))
    if (!r.ok) throw new Error(r.error)
    const g = exportGate(r.prepared.issues, false)
    expect(g.ok).toBe(false)
    expect(g.blocking).toMatchObject([{ code: 'runtime-check-missing', severity: 'error' }])
    expect(g.blocking[0]!.message).toMatch(/Package Mod will not package a menu mod without it/)
  })
  it('a project without any menu never gets the row (HUD widgets do not use the runtime)', () => {
    const p = planDeploy({ modId: 'M', root: 'C:\\mods\\M', gameDirs: [], hasPapyrus: true, swfs: [{ name: 'hud', orphaned: false, kind: 'hudWidget' }] })
    expect(p.files.some((f) => f.rel.includes('RuntimeCheck'))).toBe(false)
    expect(p.notes).toEqual([])
  })
})

describe('widget + menu in one mod', () => {
  it('keep two plugins: the widget one (SkyUI master) and the runtime check (no master); no file or script name collides', () => {
    const swfs: SwfLike[] = [{ name: 'hud', orphaned: false, kind: 'hudWidget' }, { name: 'wheel', orphaned: false, kind: 'customMenu' }]
    const p = planDeploy({ modId: 'M', root: 'C:\\mods\\M', gameDirs: [], hasPapyrus: true, swfs })
    const rels = p.files.map((f) => f.rel.toLowerCase())
    expect(new Set(rels).size).toBe(rels.length)
    expect(rels).toContain('m.esp')
    expect(rels).toContain('m_runtimecheck.esp')
    expect(p.errors).toEqual([])
    // a widget called "RuntimeCheck" would be M_RuntimeCheck.psc: the plan reports the clash instead of overwriting the check
    const clash = planDeploy({ modId: 'M', root: 'C:\\mods\\M', gameDirs: [], hasPapyrus: true, swfs: [{ name: 'runtimeCheck', orphaned: false, kind: 'hudWidget' }, swfs[1]!] })
    expect(clash.errors.join()).toMatch(/same file/)
  })
})

describe('minimum version', () => {
  it('is the highest `since` of the features used, 0.3.0 by default; the project takes the highest of its menus', () => {
    expect(minRuntimeFor()).toBe('0.3.0')
    expect(minRuntimeFor(['menu', 'savedVariables', 'list', 'nope'])).toBe('0.3.0')
    expect(maxVersion(['0.3.0', '0.4.2', '0.3.9'])).toBe('0.4.2')
    expect(projectMinRuntime([{ name: 'a', orphaned: false, kind: 'customMenu' }])).toBe('0.3.0')
    expect(projectMinRuntime([])).toBe('0.3.0')
  })
})

describe('hardening', () => {
  it('menu.json with hostile names: a readable gate error or a refused plan, never a write outside the target', async () => {
    const hostile: Record<string, unknown>[] = [
      { name: '../../evil' }, { name: 'a b' }, { name: '' }, { name: 'x'.repeat(500) }, { name: 'C:\\evil' }, { name: 'CON' },
      { swf: '../../evil.swf' }, { swf: 'C:\\evil.swf' }, { swf: 'Interface/\u0000x.swf' }, { swf: '/abs.swf' }, { swf: 'Interface//x.swf' },
      { triggers: { hotkey: -5 } }, { triggers: { hotkey: 99999 } }, { triggers: { modEvent: 'bad name!' } }
    ]
    for (const h of hostile) {
      const parsed = MenuSettings.safeParse({ specVersion: 6, ...h })
      const menu = parsed.success ? parsed.data : undefined
      const i = input({ papyrusExe: papyrusExe ?? '' })
      if (!menu) continue // the schema refuses it: the project loader reports `menu-file-invalid`
      i.swfs = [swf('wheel', menu)]
      const r = await prepareDeploy(i)
      if (!r.ok) {
        expect(r.error, JSON.stringify(h)).toMatch(/unsafe path|not usable|would leave|same file/i)
        continue
      }
      const g = exportGate(r.prepared.issues, false)
      for (const [rel] of r.prepared.files) expect(rel, JSON.stringify(h)).not.toMatch(/\.\.|^[A-Za-z]:|^\//)
      if (!g.ok) for (const b of g.blocking) expect(b.message.length, JSON.stringify(h)).toBeGreaterThan(10)
    }
  })
  it('a menu named like a Windows device (CON, nul, Com1) is a readable gate error, not a write to the console', async () => {
    for (const name of ['CON', 'nul', 'Com1']) {
      const i = input()
      i.swfs = [swf('wheel', MenuSettings.parse({ specVersion: 6, name }))]
      const r = await prepareDeploy(i)
      if (!r.ok) throw new Error(r.error)
      const g = exportGate(r.prepared.issues, false)
      expect(g.ok, name).toBe(false)
      expect(g.blocking[0], name).toMatchObject({ code: 'menu-name-invalid', swf: 'wheel' })
      expect(g.blocking[0]!.message).toContain('reserved Windows device name')
      expect([...r.prepared.files.keys()].some((k) => /menus\//.test(k)), name).toBe(false)
    }
    expect(() => safeJoin('C:\\mods\\M', 'Interface/Inkwell/CON/x.swf')).toThrow(/device name/)
    expect(() => safeJoin('C:\\mods\\M', 'SKSE/nul.json')).toThrow(/device name/)
  })
  it('a project with zero menus and the slot limits use the Spec constants', () => {
    expect(menuLint('M', [])).toEqual([])
    const many = (n: number) => Array.from({ length: n }, (_, k) => ({ swf: `m${k}`, settings: defaultMenuSettings() }))
    expect(menuLint('M', many(MENU_WARN_THRESHOLD)).filter((r) => r.code === 'menu-limit')).toEqual([])
    expect(menuLint('M', many(MENU_WARN_THRESHOLD + 1)).filter((r) => r.code === 'menu-limit')).toMatchObject([{ severity: 'warning' }])
    expect(menuLint('M', many(MENU_SLOTS)).filter((r) => r.code === 'menu-limit')).toMatchObject([{ severity: 'warning' }])
    const over = menuLint('M', many(MENU_SLOTS + 1)).filter((r) => r.code === 'menu-limit')
    expect(over).toMatchObject([{ severity: 'error' }])
    expect(over[0]!.message).toContain(String(MENU_SLOTS))
  })
})
