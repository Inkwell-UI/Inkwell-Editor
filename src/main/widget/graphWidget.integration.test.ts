// Vertical slice (PLAN-0.2 section 6): graph JSON in, SWF + Papyrus out, with the real FFDec. Skipped without Java, FFDec or the wrapper jar (a warning says so);
// the .pex part also needs INKWELL_PAPYRUS (the user's russo papyrus.exe).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { corePack } from '../codegen/codegen.testutil'
import { loadCodegenPacks } from '../codegen/packs'
import { loadProject } from '../project'
import { compileSwf } from '../swf/compile'
import { compileWidget, writeModFolder } from './compileWidget'

const ffdecDir = process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
const javaPath = process.env['INKWELL_JAVA'] ?? 'java'
const jarPath = resolve(__dirname, '../../../tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const sample = resolve(__dirname, '../../../samples/hud-graph')
const hasJava = (() => {
  try {
    execFileSync(javaPath, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const can = hasJava && existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath) && existsSync(join(ffdecDir, 'ffdec-cli.jar'))
if (!can) console.warn(`[graph slice test] SKIPPED: Java=${hasJava} FFDec=${existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar'))} wrapper jar=${existsSync(jarPath)}`)
const papyrusExe = process.env['INKWELL_PAPYRUS'] && existsSync(process.env['INKWELL_PAPYRUS']) ? process.env['INKWELL_PAPYRUS'] : undefined

/** AS2 action bytes are hex in the XML, so strings are searched hex-encoded. */
const hex = (s: string): string => Buffer.from(s).toString('hex')
const xmlOf = (swf: string, dir: string): string => {
  const out = join(dir, 'swf.xml')
  execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', swf, out], { stdio: 'ignore' })
  return readFileSync(out, 'utf8')
}

describe.skipIf(!can)('samples/hud-graph (real FFDec)', () => {
  it('graph in, widget mod folder out: SWF with the graph class, Papyrus Show(asTitle), .pex when the compiler is set', async () => {
    const project = await loadProject(sample)
    const s = project.swfs['hud']!
    const ir = Swf.parse(s.ir)
    const { packs } = await loadCodegenPacks([corePack])
    const names = Object.fromEntries(Object.entries((s.overlay as { nodes: Record<string, { instanceName?: string }> }).nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : [])))
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-graph-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const r = await compileWidget(ir, {
        modId: project.meta.modId, widgetName: 'Hud', buildDir: join(dir, 'work'), ffdec, instanceNames: names, graphs: { graphs: Object.values(s.graphs ?? {}), packs },
        ...(papyrusExe ? { papyrusExe } : {})
      })
      expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
      expect(Object.keys(r.files).sort()).toEqual(
        [
          'Interface/exported/widgets/InkwellGraphTest/Hud.swf', 'Source/Scripts/InkwellGraphTest_Hud.psc', 'Source/Scripts/InkwellGraphTest_HudInstance.psc', 'InkwellGraphTest.esp',
          ...(papyrusExe ? ['Scripts/InkwellGraphTest_Hud.pex', 'Scripts/InkwellGraphTest_HudInstance.pex'] : [])
        ].sort()
      )
      expect(r.files['Source/Scripts/InkwellGraphTest_Hud.psc']!.toString()).toContain('Function Show(String asTitle)')
      for (const [p, b] of Object.entries(r.files).filter(([p]) => p.endsWith('.pex'))) expect([...b.subarray(0, 4)], p).toEqual([0xfa, 0x57, 0xc0, 0xde])
      const out = join(dir, 'mod')
      await writeModFolder(out, r.files)
      const xml = xmlOf(join(out, 'Interface', 'exported', 'widgets', 'InkwellGraphTest', 'Hud.swf'), dir)
      expect(xml).toContain('__Packages.mods.InkwellGraphTest.HudGraph_main')
      expect(xml).toContain(hex('inkwellGraph0')) // instantiated from the frame code
      expect(xml).toContain(hex('Show')) // the clip method Papyrus calls
      expect(xml).toContain(hex('shown')) // the Log message of the Branch's true exit
      // the source map was written next to the build
      const map = JSON.parse(readFileSync(join(dir, 'work', 'hud', 'graph-main.map.json'), 'utf8')) as { lines: Record<string, string> }
      expect(Object.values(map.lines)).toEqual(expect.arrayContaining(['call', 'settext', 'branch', 'log']))
    } finally {
      ffdec.stop()
    }
  }, 120_000)

  it('the Ruffle preview build path carries the graph too (preview: true, device fonts)', async () => {
    const project = await loadProject(sample)
    const s = project.swfs['hud']!
    const { packs } = await loadCodegenPacks([corePack])
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-graph-prev-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const r = await compileSwf(Swf.parse(s.ir), { modId: project.meta.modId, buildDir: dir, ffdec, preview: true, instanceNames: { '2:4': 'title', '2:5': 'subtitle' }, graphs: { graphs: Object.values(s.graphs ?? {}), packs } })
      expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
      const xml = xmlOf(r.swfPath, dir)
      expect(xml).toContain('__Packages.mods.InkwellGraphTest.HudGraph_main')
      expect(xml).toContain(hex('inkwellGraph0'))
    } finally {
      ffdec.stop()
    }
  }, 120_000)

  it('a script FFDec cannot parse fails the build (the wrapper reports it)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-bad-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const { packs } = await loadCodegenPacks([corePack])
      const bad = { ...packs, templates: new Map([...packs.templates].map(([k, v]) => [k, k === 'core/Log@1' ? v.replace('trace(', 'trace((') : v])) }
      const project = await loadProject(sample)
      const s = project.swfs['hud']!
      await expect(compileSwf(Swf.parse(s.ir), { modId: 'X', buildDir: dir, ffdec, instanceNames: { '2:4': 'title' }, graphs: { graphs: Object.values(s.graphs ?? {}), packs: bad } })).rejects.toThrow(/AS2 script error/)
    } finally {
      ffdec.stop()
    }
  }, 120_000)
})
