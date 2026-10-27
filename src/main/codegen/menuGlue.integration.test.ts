// The menu glue compiled by the real FFDec (the AS2 must parse): samples/menu-slice as the game SWF and as the Ruffle preview SWF, and a menu without graphs.
// Skipped without Java, FFDec or the wrapper jar (a warning says so). What the glue DOES is the Ruffle run (screenshotMenu driver).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf, type Graph } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { loadProject } from '../project'
import { compileSwf } from '../swf/compile'
import { corePack } from './codegen.testutil'
import { loadCodegenPacks } from './packs'

const ffdecDir = process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
const javaPath = process.env['INKWELL_JAVA'] ?? 'java'
const jarPath = resolve(__dirname, '../../../tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const sample = resolve(__dirname, '../../../samples/menu-slice')
const hasJava = (() => {
  try {
    execFileSync(javaPath, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const can = hasJava && existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath) && existsSync(join(ffdecDir, 'ffdec-cli.jar'))
if (!can) console.warn(`[menu glue test] SKIPPED: Java=${hasJava} FFDec=${existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar'))} wrapper jar=${existsSync(jarPath)}`)

const hex = (s: string): string => Buffer.from(s).toString('hex')
/** The slice graph with its Set Text keyed and an On Update that writes Get Time into the same text (FFDec must parse `tr` and both templates). */
const keyedClock = (g: Graph): Graph => ({
  ...g,
  nodes: [
    ...g.nodes.map((n) => (n.kind === 'core/SetText@1' ? { ...n, fields: { ...n.fields, text: '$Inkwell_InkwellMenuTest_Clicked' } } : n)),
    { id: 'upd', kind: 'core/OnUpdate@1', fields: { seconds: 0.5, name: 'clock' }, pos: { x: 0, y: 200 } },
    { id: 'now', kind: 'core/GetTime@1', fields: {}, pos: { x: 0, y: 300 } },
    { id: 'show', kind: 'core/SetText@1', fields: { target: g.nodes.find((n) => n.kind === 'core/SetText@1')!.fields['target'] }, pos: { x: 260, y: 200 } }
  ] as Graph['nodes'],
  edges: [...g.edges, { from: { node: 'upd', pin: 'then' }, to: { node: 'show', pin: 'in' } }, { from: { node: 'now', pin: 'value' }, to: { node: 'show', pin: 'text' } }]
})
const xmlOf = (swf: string, dir: string): string => {
  const out = join(dir, 'swf.xml')
  execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', swf, out], { stdio: 'ignore' })
  return readFileSync(out, 'utf8')
}

describe.skipIf(!can)('samples/menu-slice (real FFDec)', () => {
  const run = async (opts: { preview?: boolean; noGraphs?: boolean; keyedClock?: boolean }) => {
    const project = await loadProject(sample)
    const s = project.swfs['menu']!
    const { packs } = await loadCodegenPacks([corePack])
    const nodes = (s.overlay as { nodes: Record<string, { instanceName?: string; role?: string }> }).nodes
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-menu-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const r = await compileSwf(Swf.parse(s.ir), {
        modId: project.meta.modId, buildDir: dir, ffdec, ...(opts.preview ? { preview: true } : {}),
        instanceNames: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : []))),
        roles: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.role ? [[id, o.role]] : []))),
        ...(opts.noGraphs ? {} : { graphs: { graphs: Object.values(s.graphs ?? {}).map((g) => (opts.keyedClock ? keyedClock(g) : g)), packs } })
      })
      expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
      return xmlOf(r.swfPath, dir)
    } finally {
      ffdec.stop()
    }
  }

  it('game SWF: the menu class, the graph class and the frame code that starts the menu; no mock bridge', async () => {
    const xml = await run({})
    expect(xml).toContain('__Packages.mods.InkwellMenuTest.MenuMenu')
    expect(xml).toContain('__Packages.mods.InkwellMenuTest.MenuGraph_main')
    expect(xml).toContain(hex('inkwellMenu'))
    expect(xml).toContain(hex('glueReady'))
    expect(xml).toContain(hex('inkwell bridge missing'))
    expect(xml).not.toContain(hex('inkwellMenuOpen'))
  }, 120_000)

  it('preview SWF: the same plus the mock bridge and the Play panel callbacks', async () => {
    const xml = await run({ preview: true })
    expect(xml).toContain('__Packages.mods.InkwellMenuTest.MenuMenu')
    expect(xml).toContain(hex('inkwellMenuOpen'))
    expect(xml).toContain(hex('inkwellClick'))
  }, 120_000)

  it('0.5 nodes: a keyed Set Text (__g.tr) and On Update + Get Time compile in a menu', async () => {
    const xml = await run({ keyedClock: true })
    expect(xml).toContain(hex('$Inkwell_InkwellMenuTest_Clicked'))
    expect(xml).toContain('__Packages.mods.InkwellMenuTest.MenuGraph_main')
  }, 120_000)

  it('a customMenu without graphs still compiles with the glue', async () => {
    const xml = await run({ noGraphs: true })
    expect(xml).toContain('__Packages.mods.InkwellMenuTest.MenuMenu')
    expect(xml).not.toContain('MenuGraph_main')
  }, 120_000)
})
