// Phase 6 with the real FFDec: the preview build of a graph with data bindings, mock data, pin traces and a node that throws still compiles (the AS2 parses),
// and the game build of the same graph carries none of the preview code. What the preview does at run time was checked in Ruffle (docs/debugging.md, Verifying).
// Skipped without Java, FFDec or the wrapper jar.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf, type Graph } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { corePack } from '../codegen/codegen.testutil'
import { loadCodegenPacks } from '../codegen/packs'
import { loadProject } from '../project'
import { compileSwf } from '../swf/compile'

const ffdecDir = process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
const javaPath = process.env['INKWELL_JAVA'] ?? 'java'
const jarPath = resolve(__dirname, '../../../tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const sample = resolve(__dirname, '../../../samples/hud-graph')
const throwNode = resolve(__dirname, '../../../tests/fixtures/packs/throw-node')
const hasJava = (() => {
  try {
    execFileSync(javaPath, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const can = hasJava && existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath) && existsSync(join(ffdecDir, 'ffdec-cli.jar'))
const hex = (s: string): string => Buffer.from(s).toString('hex')
const xmlOf = (swf: string, dir: string): string => {
  const out = join(dir, 'swf.xml')
  execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', swf, out], { stdio: 'ignore' })
  return readFileSync(out, 'utf8')
}

describe.skipIf(!can)('graph debugging build (real FFDec)', () => {
  it('compiles the preview with bindings, mock listeners, pin traces and a throwing node; the game build has no preview code', async () => {
    const project = await loadProject(sample)
    const s = project.swfs['hud']!
    const core = (await loadCodegenPacks([corePack])).packs
    const def = JSON.parse(readFileSync(join(throwNode, 'nodes/Throw.json'), 'utf8')) as never
    const packs = { defs: new Map([...core.defs, ['core/Throw@1', def]]), templates: new Map([...core.templates, ['core/Throw@1', readFileSync(join(throwNode, 'templates/Throw.as2'), 'utf8')]]) }
    const g = structuredClone(Object.values(s.graphs ?? {})[0]!) as Graph
    g.nodes.push({ id: 'boom', kind: 'core/OnWidgetCall@1', fields: { name: 'Boom', params: [] }, pos: { x: 0, y: 0 } }, { id: 'x', kind: 'core/Throw@1', fields: { message: 'deliberate error' }, pos: { x: 0, y: 0 } }, { id: 'sv', kind: 'core/SetVariable@1', fields: { variable: 'greeting' }, pos: { x: 0, y: 0 } })
    g.edges.push({ from: { node: 'boom', pin: 'then' }, to: { node: 'x', pin: 'in' } }, { from: { node: 'log', pin: 'then' }, to: { node: 'sv', pin: 'in' } }, { from: { node: 'call', pin: 'title' }, to: { node: 'sv', pin: 'value' } })
    g.variables.push({ id: 'greeting', name: 'greeting', type: 'String', scope: 'menu', default: 'hi' } as Graph['variables'][number])
    const opts = { modId: project.meta.modId, instanceNames: { '2:4': 'title', '2:5': 'subtitle' }, bindings: { '2:5': 'text=var:greeting;alpha=mock:fade' }, graphs: { graphs: [g], packs } }
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-graph-debug-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const prev = await compileSwf(Swf.parse(s.ir), { ...opts, buildDir: join(dir, 'preview'), ffdec, preview: true })
      expect(prev.lint.filter((l) => l.severity === 'error')).toEqual([])
      const px = xmlOf(prev.swfPath, dir)
      for (const word of ['inkwellCall', 'inkwellMock', 'inkwellMockDone', 'inkwellGet', 'mockListeners', 'b_greeting', 'deliberate error']) expect(px, word).toContain(hex(word))
      const game = await compileSwf(Swf.parse(s.ir), { ...opts, buildDir: join(dir, 'game'), ffdec })
      expect(game.lint.filter((l) => l.severity === 'error')).toEqual([])
      const gx = xmlOf(game.swfPath, dir)
      expect(gx).toContain(hex('b_greeting')) // the variable binding is part of the game too
      for (const word of ['inkwellCall', 'mockListeners', 'inkwellMock']) expect(gx, word).not.toContain(hex(word))
    } finally {
      ffdec.stop()
    }
  }, 120_000)
})
