// The vanilla/guard tests need nothing external. The real deploy needs Java, the user's FFDec and the wrapper jar (like the other FFDec tests);
// the .pex/.esp part also needs INKWELL_PAPYRUS (or a papyrus path in the environment).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { createAssetStore } from '../images/assets'
import { readDdsBgra8, readDdsHeader } from '../images/dds'
import { syntheticPng } from '../images/synthetic'
import { loadProject } from '../project'
import { frame } from '../swf/ir.testutil'
import { sha256 } from '../vanilla/bsa'
import { commitDeploy, prepareDeploy, type DeployInput, type DeploySwf } from './run'
import { readManifest } from './write'
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

  it('customMenu deploys its built SWF to Interface/<name>.swf', async () => {
    const i = input({})
    writeFileSync(join(i.buildDir, 'wheel.swf'), 'FWS-mine')
    const r = await prepareDeploy(i)
    expect(r.ok && r.prepared.info).toEqual([{ rel: 'Interface/wheel.swf', size: 8, swf: 'wheel' }])
    if (r.ok) expect((await commitDeploy(i, r.prepared)).ok).toBe(true)
    expect(readFileSync(join(i.root, 'Interface', 'wheel.swf'), 'utf8')).toBe('FWS-mine')
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
      { severity: 'warning', code: 'unreachable-node', message: expect.stringContaining('Stray'), swf: 'wheel', nodeId: 'x', layerName: 'Stray' }
    ])
    expect([...all.prepared.files.keys()]).toEqual(['Interface/wheel.swf']) // the blocked SWF contributes nothing
    const one = await prepareDeploy({ ...i, only: 'wheel' })
    expect(one.ok && one.prepared.issues.map((l) => l.swf)).toEqual(['wheel'])
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
    expect(r.prepared.info.map((f) => f.rel).sort()).toEqual(['Interface/wheel.swf', rel])
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

  it('a path-traversal SWF name is refused', async () => {
    const i = input({ swfs: [swf('..\\..\\evil')] })
    mkdirSync(join(i.buildDir, '..'), { recursive: true })
    expect(await prepareDeploy(i)).toMatchObject({ ok: false, error: expect.stringContaining('unsafe path') })
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
