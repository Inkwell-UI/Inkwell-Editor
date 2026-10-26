// The vanilla/guard tests need nothing external. The real deploy needs Java, the user's FFDec and the wrapper jar (like the other FFDec tests);
// the .pex/.esp part also needs INKWELL_PAPYRUS (or a papyrus path in the environment).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MenuSettings, Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { createAssetStore } from '../images/assets'
import { readDdsBgra8, readDdsHeader } from '../images/dds'
import { syntheticPng } from '../images/synthetic'
import { loadCodegenPacks } from '../codegen/packs'
import { loadProject } from '../project'
import { frame } from '../swf/ir.testutil'
import { sha256 } from '../vanilla/bsa'
import { commitDeploy, prepareDeploy, type DeployInput, type DeploySwf } from './run'
import { readManifest, writeDeploy } from './write'
import { readZipEntry } from '../doctor/zip'
import { writeZip } from './zip'

const appPath = resolve(__dirname, '../../..')
const ffdecDir = process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
const javaPath = process.env['INKWELL_JAVA'] ?? 'java'
const jarPath = join(appPath, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const hasJava = (() => {
  try {
    execFileSync(javaPath, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const can = hasJava && existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath)
const papyrusExe = process.env['INKWELL_PAPYRUS'] && existsSync(process.env['INKWELL_PAPYRUS']) ? process.env['INKWELL_PAPYRUS'] : undefined
const noFfdec = { build: () => Promise.reject(new Error('FFDec must not be used here')) }

describe('prepareDeploy guards', () => {
  const swf = (name: string): DeploySwf => ({ name, orphaned: false, kind: 'customMenu' as const, ir: { root: 'r', nodes: { r: frame('r', []) } } as unknown as Swf, build: { state: 'done', lint: [] } })
  const input = (over: Partial<DeployInput>): DeployInput => ({
    modId: 'M', swfs: [swf('wheel')], root: join(mkdtempSync(join(tmpdir(), 'inkwell-run-')), 'mod'), gameDirs: [], buildDir: mkdtempSync(join(tmpdir(), 'inkwell-build-')),
    ffdec: noFfdec, vanillaHashes: new Set(), ...over
  })

  it('customMenu deploys its built SWF under Interface/Inkwell/<modId>/, the MenuDef JSON and the commented default INI', async () => {
    const i = input({ modName: 'My Mod', swfs: [{ ...swf('wheel'), menu: MenuSettings.parse({ specVersion: 6, flags: { pausesGame: true, cursor: true, modal: true }, triggers: { hotkey: 37, modEvent: 'M_Open' }, userDefaults: { uiScale: 1.25 } }) }] })
    writeFileSync(join(i.buildDir, 'wheel.swf'), 'FWS-mine')
    const r = await prepareDeploy(i)
    expect(r.ok && r.prepared.info.map((f) => f.rel)).toEqual(['Interface/Inkwell/M/Wheel.swf', 'SKSE/Plugins/Inkwell/menus/M_Wheel.json', 'SKSE/Plugins/Inkwell/M.ini'])
    expect(r.ok && r.prepared.info.find((f) => f.rel.endsWith('.ini'))).toMatchObject({ keepExisting: true })
    if (!r.ok) throw new Error(r.error)
    expect((await commitDeploy(i, r.prepared)).ok).toBe(true)
    expect(readFileSync(join(i.root, 'Interface', 'Inkwell', 'M', 'Wheel.swf'), 'utf8')).toBe('FWS-mine')
    // the JSON is the Spec's MenuDef: validated, the effective input context written out, no author-only keys
    expect(JSON.parse(readFileSync(join(i.root, 'SKSE', 'Plugins', 'Inkwell', 'menus', 'M_Wheel.json'), 'utf8'))).toEqual({
      specVersion: 6, name: 'M_Wheel', swf: 'Interface/Inkwell/M/Wheel.swf', minRuntime: '0.3.0',
      flags: { pausesGame: true, cursor: true, modal: true, closeOnEscape: true }, inputContext: 'menuMode', depth: 3, triggers: { hotkey: 37, papyrus: true, modEvent: 'M_Open' }
    })
    const iniPath = join(i.root, 'SKSE', 'Plugins', 'Inkwell', 'M.ini')
    const ini = readFileSync(iniPath, 'utf8')
    expect(ini).toContain('; Inkwell Runtime settings for My Mod (M).')
    expect(ini).toContain('\n[Menu.M_Wheel]\n')
    expect(ini).toContain(';OpenKey=37') // the author's hotkey shows commented
    expect(ini).toContain('\nUIScale=1.25\n') // a default that differs from the built-in one is uncommented
    // the INI is the user's after the first deploy: never overwritten, never retired, and not in the manifest
    writeFileSync(iniPath, '[Menu.M_Wheel]\nUIScale=0.75\n')
    const again = await prepareDeploy(i)
    if (!again.ok) throw new Error(again.error)
    expect(await commitDeploy(i, again.prepared)).toMatchObject({ ok: true, preserved: ['SKSE/Plugins/Inkwell/M.ini'], unchanged: 2 })
    expect(readFileSync(iniPath, 'utf8')).toBe('[Menu.M_Wheel]\nUIScale=0.75\n')
    expect(Object.keys((await readManifest(i.root))!.files)).toEqual(['Interface/Inkwell/M/Wheel.swf', 'SKSE/Plugins/Inkwell/menus/M_Wheel.json'])
    // a menu removed from the project retires its SWF and JSON, but the INI stays
    const gone = await prepareDeploy({ ...i, swfs: [] })
    expect(gone.ok).toBe(false) // no SWF at all is a plan error; the INI is not even considered
    expect(existsSync(iniPath)).toBe(true)
  })

  it('a deploy from before the menu layout retires its flat Interface/<name>.swf (byte-identical files only)', async () => {
    const i = input({})
    writeFileSync(join(i.buildDir, 'wheel.swf'), 'FWS-mine')
    await writeDeploy({ root: i.root, modId: 'M', files: new Map([['Interface/wheel.swf', { data: Buffer.from('FWS-old'), swf: 'wheel' }]]) })
    const r = await prepareDeploy(i)
    if (!r.ok) throw new Error(r.error)
    expect(r.prepared.removed).toEqual(['Interface/wheel.swf'])
    expect(await commitDeploy(i, r.prepared)).toMatchObject({ ok: true, removed: ['Interface/wheel.swf'] })
    expect(existsSync(join(i.root, 'Interface', 'wheel.swf'))).toBe(false)
    expect(existsSync(join(i.root, 'Interface', 'Inkwell', 'M', 'Wheel.swf'))).toBe(true)
  })

  it('the menu gate: invalid and duplicate names, the slot limit (warning above 4, error above 16), an unreadable menu.json', async () => {
    const menus = (n: number, over: (k: number) => Partial<DeploySwf> = () => ({})): DeploySwf[] => Array.from({ length: n }, (_, k) => ({ ...swf(`m${k}`), ...over(k) }))
    const issues = async (swfs: DeploySwf[], only?: string) => {
      const i = input({ swfs, ...(only ? { only } : {}) })
      for (const s of swfs) writeFileSync(join(i.buildDir, `${s.name}.swf`), 'FWS-' + s.name)
      const r = await prepareDeploy(i)
      if (!r.ok) throw new Error(r.error)
      return r.prepared.issues.filter((x) => x.code.startsWith('menu') || x.code === 'saved-variable-invalid')
    }
    expect(await issues(menus(4))).toEqual([])
    expect(await issues(menus(5))).toMatchObject([{ severity: 'warning', code: 'menu-limit' }])
    expect(await issues(menus(16))).toMatchObject([{ severity: 'warning', code: 'menu-limit' }])
    expect(await issues(menus(17))).toMatchObject([{ severity: 'error', code: 'menu-limit', message: expect.stringContaining('17') }])
    // a deploy of one SWF still lints the project's slot count
    expect(await issues(menus(17), 'm3')).toMatchObject([{ severity: 'error', code: 'menu-limit' }])
    expect(await issues(menus(2, (k) => ({ menu: MenuSettings.parse({ specVersion: 6, name: k ? 'M_ONE' : 'M_one' }) })))).toMatchObject([{ severity: 'error', code: 'menu-name-duplicate', swf: 'm1' }])
    const broken = await issues([{ ...swf('wheel'), menuError: 'menu.json: Unexpected token' }])
    expect(broken).toMatchObject([{ severity: 'error', code: 'menu-file-invalid', swf: 'wheel' }])
  })

  it('refuses an unmodified vanilla SWF and writes nothing', async () => {
    const i = input({})
    writeFileSync(join(i.buildDir, 'wheel.swf'), 'vanilla-bytes')
    const r = await prepareDeploy({ ...i, vanillaHashes: new Set([sha256(Buffer.from('vanilla-bytes'))]) })
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('unmodified vanilla') })
    expect(existsSync(i.root)).toBe(false)
  })

  it('refuses the game Data folder before compiling anything', async () => {
    const r = await prepareDeploy(input({ root: 'C:\\Games\\Skyrim Special Edition\\Data', gameDirs: ['C:\\Games\\Skyrim Special Edition'] }))
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('Data folder') })
  })

  it('a missing, unfinished or failed build is a gate error, and nothing of that SWF is deployed', async () => {
    const issue = async (s: DeploySwf, file = true) => {
      const i = input({ swfs: [s] })
      if (file) writeFileSync(join(i.buildDir, 'wheel.swf'), 'FWS-mine')
      const r = await prepareDeploy(i)
      if (!r.ok) throw new Error(r.error)
      expect(r.prepared.files.size).toBe(0)
      return r.prepared.issues
    }
    expect(await issue(swf('wheel'), false)).toMatchObject([{ severity: 'error', code: 'build-not-ready', swf: 'wheel', message: expect.stringContaining('Run Build All') }])
    const { build: _b, ...unbuilt } = swf('wheel')
    expect(await issue(unbuilt)).toMatchObject([{ code: 'build-not-ready', message: expect.stringContaining('not been built since') }])
    expect(await issue({ ...swf('wheel'), build: { state: 'compiling', lint: [] } })).toMatchObject([{ code: 'build-not-ready', message: expect.stringContaining('still compiling') }])
    expect(await issue({ ...swf('wheel'), build: { state: 'failed', lint: [] } })).toMatchObject([{ code: 'build-not-ready', message: expect.stringContaining('last build failed') }])
  })

  it("a custom menu's build lint and unreachable layers feed the gate, scoped to the deployed SWF", async () => {
    const bad: DeploySwf = { ...swf('bad'), build: { state: 'done', lint: [{ severity: 'error', code: 'font-unmapped', message: 'no alias', nodeId: '1:5', layerName: 'Title' }] } }
    const loose = { ...swf('wheel'), ir: { root: 'r', nodes: { r: frame('r', []), x: { ...frame('x', []), name: 'Stray' } } } as unknown as Swf }
    const i = input({ swfs: [bad, loose] })
    writeFileSync(join(i.buildDir, 'bad.swf'), 'FWS-bad')
    writeFileSync(join(i.buildDir, 'wheel.swf'), 'FWS-mine')
    const all = await prepareDeploy(i)
    if (!all.ok) throw new Error(all.error)
    expect(all.prepared.issues).toEqual([
      { severity: 'error', code: 'font-unmapped', message: 'no alias', nodeId: '1:5', layerName: 'Title', swf: 'bad' },
      { severity: 'warning', code: 'unreachable-node', message: expect.stringContaining('Stray'), swf: 'wheel', nodeId: 'x', layerName: 'Stray' },
      { severity: 'warning', code: 'runtime-check-missing', message: expect.stringContaining('no Papyrus compiler'), swf: 'wheel' } // no compiler in this input: a folder deploy only warns
    ])
    expect([...all.prepared.files.keys()]).toEqual(['Interface/Inkwell/M/Wheel.swf', 'SKSE/Plugins/Inkwell/menus/M_Wheel.json', 'SKSE/Plugins/Inkwell/M.ini']) // the blocked SWF contributes nothing
    const one = await prepareDeploy({ ...i, only: 'wheel' })
    expect(one.ok && one.prepared.issues.map((l) => l.swf)).toEqual(['wheel', 'wheel'])
  })

  it('dds image mode adds one DDS per image under textures/Inkwell/<modId>/, recorded in the manifest; embedded mode adds nothing', async () => {
    const img = syntheticPng(64, 32)
    const ir = { nodes: { f: { ...frame('f', ['i']), fills: [{ type: 'image', asset: img.hash }] }, i: { ...frame('i', []), type: 'image', asset: img.hash, scaleMode: 'fit' } } } as unknown as Swf
    const assets = createAssetStore()
    await assets.put(img.hash, img.png)
    const i = input({ swfs: [{ ...swf('wheel'), ir }], imageMode: 'dds', assets })
    writeFileSync(join(i.buildDir, 'wheel.swf'), 'FWS-mine')
    const r = await prepareDeploy(i)
    if (!r.ok) throw new Error(r.error)
    const rel = `textures/Inkwell/M/${img.hash}.dds`
    expect(r.prepared.info.map((f) => f.rel).sort()).toEqual(['Interface/Inkwell/M/Wheel.swf', 'SKSE/Plugins/Inkwell/M.ini', 'SKSE/Plugins/Inkwell/menus/M_Wheel.json', rel])
    expect(readDdsHeader(r.prepared.files.get(rel)!.data)).toMatchObject({ width: 64, height: 32, format: 'BGRA8' })
    expect((await commitDeploy(i, r.prepared)).ok).toBe(true)
    expect(readDdsBgra8(readFileSync(join(i.root, 'textures', 'Inkwell', 'M', `${img.hash}.dds`)))).toEqual(img.image)
    expect(Object.keys((await readManifest(i.root))!.files)).toContain(rel)
    // back to embedded: the DDS is retired like any other file this deploy no longer produces
    const r2 = await prepareDeploy({ ...i, imageMode: 'embedded' })
    expect(r2.ok && r2.prepared.removed).toEqual([rel])
  })

  it('dds mode with a missing asset fails before anything is written; the Data-folder guard still runs first', async () => {
    const ir = { nodes: { i: { ...frame('i', []), type: 'image', asset: 'a'.repeat(40), scaleMode: 'fill' } } } as unknown as Swf
    const i = input({ swfs: [{ ...swf('wheel'), ir }], imageMode: 'dds', assets: createAssetStore() })
    writeFileSync(join(i.buildDir, 'wheel.swf'), 'FWS-mine')
    expect(await prepareDeploy(i)).toMatchObject({ ok: false, error: expect.stringContaining('not in the project') })
    expect(existsSync(i.root)).toBe(false)
    expect(await prepareDeploy({ ...i, root: 'C:\\Games\\Skyrim Special Edition\\Data' })).toMatchObject({ ok: false, error: expect.stringContaining('Data folder') })
  })

  it('a path-traversal SWF name cannot leave the target: the menu file names are sanitised, an explicit swf path is refused', async () => {
    const i = input({})
    const r = await prepareDeploy({ ...i, swfs: [{ ...swf('a-b'), name: 'a/b' }] })
    expect(r.ok && r.prepared.files.size).toBe(0) // there is no build file for it (build-not-ready); the file names it would get are sanitised (plan.test.ts)
    const planned = await prepareDeploy({ ...input({ swfs: [{ ...swf('wheel'), menu: { specVersion: 6, swf: 'Interface/../evil.swf' } as never }] }) })
    expect(planned).toMatchObject({ ok: false, error: expect.stringContaining('unsafe path') })
  })
})

describe.skipIf(!can)('real deploy of samples/hud-widget into a temp folder', () => {
  it('writes the mod layout and a manifest; a second deploy changes nothing; a removed output is retired', async () => {
    const project = await loadProject(join(appPath, 'samples/hud-widget'))
    const ir = Swf.parse(project.swfs['hud']!.ir)
    const root = join(mkdtempSync(join(tmpdir(), 'inkwell-real-')), 'Test Mod')
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const input: DeployInput = {
        modId: project.meta.modId, swfs: [{ name: 'hud', orphaned: false, kind: 'hudWidget', ir }], root, gameDirs: [], buildDir: mkdtempSync(join(tmpdir(), 'inkwell-rb-')), ffdec,
        ...(papyrusExe ? { papyrusExe } : {}), stubsDir: join(appPath, 'resources/papyrus-stubs'), vanillaHashes: new Set()
      }
      const r = await prepareDeploy(input)
      if (!r.ok) throw new Error(r.error)
      const done = await commitDeploy(input, r.prepared)
      expect(done.ok).toBe(true)
      const rels = r.prepared.info.map((f) => f.rel).sort()
      expect(rels).toContain('Interface/exported/widgets/InkwellWidgetTest/Hud.swf')
      expect(rels).toContain('Source/Scripts/InkwellWidgetTest_Hud.psc')
      if (papyrusExe) expect(rels).toEqual(expect.arrayContaining(['Scripts/InkwellWidgetTest_Hud.pex', 'InkwellWidgetTest.esp']))
      else expect(r.prepared.lint.map((l) => l.code)).toContain('papyrus-compiler-missing')
      const swf = readFileSync(join(root, 'Interface', 'exported', 'widgets', 'InkwellWidgetTest', 'Hud.swf'))
      expect(['FWS', 'CWS']).toContain(swf.subarray(0, 3).toString('latin1'))
      const m = await readManifest(root)
      expect(Object.keys(m!.files).sort()).toEqual(rels)
      // Package Mod zips exactly these bytes at the archive root (the layout MO2 and Vortex install as is)
      const zip = writeZip([...r.prepared.files].map(([name, f]) => ({ name, data: f.data })))
      for (const rel of rels) expect(readZipEntry(zip, rel)).toEqual(readFileSync(join(root, ...rel.split('/'))))
      if (process.env['INKWELL_PACKAGE_OUT']) writeFileSync(process.env['INKWELL_PACKAGE_OUT'], zip) // manual check with an independent extractor
      // same input again: byte-identical output, nothing rewritten
      const r2 = await prepareDeploy(input)
      if (!r2.ok) throw new Error(r2.error)
      // .pex files embed the compile time, so a second compile in another second rewrites them; everything else must be untouched
      const again = await commitDeploy(input, r2.prepared)
      expect(again).toMatchObject({ ok: true, removed: [] })
      expect(again.ok && again.written).toBeLessThanOrEqual(rels.filter((f) => f.endsWith('.pex')).length)
    } finally {
      ffdec.stop()
    }
  }, 120000)
})

describe.skipIf(!can)('deploy of samples/hud-graph (graph-driven widget)', () => {
  it('ships the graph SWF and the typed Papyrus API from On Widget Call', async () => {
    const project = await loadProject(join(appPath, 'samples/hud-graph'))
    const s = project.swfs['hud']!
    const root = join(mkdtempSync(join(tmpdir(), 'inkwell-real-')), 'Graph Mod')
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const input: DeployInput = {
        modId: project.meta.modId, swfs: [{ name: 'hud', orphaned: false, kind: 'hudWidget', ir: Swf.parse(s.ir), instanceNames: { '2:4': 'title', '2:5': 'subtitle' }, graphs: Object.values(s.graphs ?? {}) }], root, gameDirs: [],
        buildDir: mkdtempSync(join(tmpdir(), 'inkwell-rb-')), ffdec, packs: (await loadCodegenPacks([join(appPath, 'resources/packs/core')])).packs,
        ...(papyrusExe ? { papyrusExe } : {}), stubsDir: join(appPath, 'resources/papyrus-stubs'), vanillaHashes: new Set()
      }
      const r = await prepareDeploy(input)
      if (!r.ok) throw new Error(r.error)
      expect(r.prepared.issues.filter((i) => i.severity === 'error')).toEqual([])
      expect((await commitDeploy(input, r.prepared)).ok).toBe(true)
      expect(readFileSync(join(root, 'Source', 'Scripts', 'InkwellGraphTest_Hud.psc'), 'utf8')).toContain('Function Show(String asTitle)')
    } finally {
      ffdec.stop()
    }
  }, 120000)
})
