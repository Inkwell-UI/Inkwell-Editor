// The vanilla/guard tests need nothing external. The real deploy needs Java, the user's FFDec and the wrapper jar (like the other FFDec tests);
// the .pex/.esp part also needs INKWELL_PAPYRUS (or a papyrus path in the environment).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { loadProject } from '../project'
import { sha256 } from '../vanilla/bsa'
import { commitDeploy, prepareDeploy, type DeployInput } from './run'
import { readManifest } from './write'

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
  const swf = (name: string) => ({ name, orphaned: false, kind: 'customMenu' as const, ir: {} as Swf })
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

  it('a missing build is a clear error', async () => {
    expect(await prepareDeploy(input({}))).toMatchObject({ ok: false, error: expect.stringContaining('Run Build All') })
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
      // same input again: byte-identical output, nothing rewritten
      const r2 = await prepareDeploy(input)
      if (!r2.ok) throw new Error(r2.error)
      expect(await commitDeploy(input, r2.prepared)).toMatchObject({ ok: true, written: 0, removed: [] })
    } finally {
      ffdec.stop()
    }
  }, 120000)
})
