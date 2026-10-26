// Phase 6b: the dev flavour of a custom menu's game SWF (SPEC-CHANGES S6/S7): `bridge.pin` / `bridge.watch` calls and `dumpVariables`. Golden AS2 for both flavours (the normal
// game build must stay free of the hooks) and the real FFDec compile of the dev SWF (skipped without Java, FFDec or the wrapper jar).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { listSettings } from '../../shared/overlay'
import { loadProject } from '../project'
import { compileSwf } from '../swf/compile'
import { generate } from '../swf/generate'
import { generateGraphClasses, type CodegenInput } from './codegen'
import { corePack, graph, node, wire } from './codegen.testutil'
import { menuClassSource } from './menuGlue'
import { loadCodegenPacks } from './packs'

const { packs } = await loadCodegenPacks([corePack])
const vars = [
  { id: 'v1', name: 'count', type: 'Number', scope: 'menu', default: 5 },
  { id: 'v2', name: 'total', type: 'Number', scope: 'saved', default: 0 },
  { id: 'v3', name: 'label', type: 'String', scope: 'component', default: 'x' }
] as never
const g = graph('main', [
  node('e', 'core/OnOpen@1'), node('a', 'core/Arithmetic@1', { op: '+', a: 1, b: 2 }),
  node('s', 'core/SetVariable@1', { variable: 'v1' }), node('t', 'core/SetVariable@1', { variable: 'v2' }), node('l', 'core/Log@1', { level: 'info' })
], [wire('e', 'then', 's', 'in'), wire('a', 'value', 's', 'value'), wire('s', 'then', 't', 'in'), wire('a', 'value', 't', 'value'), wire('t', 'then', 'l', 'in')], vars)
const gen = (extra: Partial<CodegenInput>): string => generateGraphClasses({ modId: 'M', swfCls: 'T', graphs: [g], packs, layerPath: () => undefined, ...extra }).classes[0]!.source

describe('dev flavour of the graph class', () => {
  it('pure outputs call bridge.pin, every assignment calls bridge.watch, the class has dumpVariables (golden)', () => {
    const s = gen({ menu: true, dev: true })
    expect(s).toContain('function pv(nodeId, pin, v) {')
    expect(s).toContain('this.bridge.pin(nodeId, pin, v);')
    expect(s).toContain('__g.pv("a", "value", ')
    expect(s).toContain('__g.bridge.watch("main", "count", "menu", __g.v_count);')
    expect(s).toContain('__g.bridge.watch("main", "total", "saved", __g.v_total);')
    expect(s.indexOf('__g.bridge.setSaved("total"')).toBeLessThan(s.indexOf('__g.bridge.watch("main", "total"')) // the stored value first, then the stream
    expect(s).toContain('this.bridge.watch("main", "label", "component", this.v_label);')
    expect(s).not.toContain('trace("[Inkwell] pin') // the preview mechanism, not the game's
    expect(s).toMatchSnapshot()
  })
  it('the normal game flavour and a HUD widget have none of it (golden)', () => {
    const s = gen({ menu: true })
    for (const w of ['bridge.pin', 'bridge.watch', 'dumpVariables', '__g.pv(', 'function pv']) expect(s).not.toContain(w)
    expect(s).toMatchSnapshot()
    expect(gen({ dev: true })).toBe(gen({})) // dev without the menu flavour does nothing: HUD widgets are byte-identical
  })
  it('the preview keeps its trace based pins', () => {
    const s = gen({ menu: true, preview: true })
    expect(s).toContain('trace("[Inkwell] pin "')
    expect(s).not.toContain('bridge.pin')
  })
})

describe('dev flavour of the menu class', () => {
  it('dumpVariables asks every graph, each guarded (golden); the normal flavour keeps the empty method', () => {
    const base = { modId: 'MyMod', swfCls: 'Wheel', graphs: [{ cls: 'WheelGraph_main', id: 'main' }] }
    const dev = menuClassSource({ ...base, dev: true })
    expect(dev).toContain('this.graphs[k].dumpVariables();')
    expect(dev).toMatchSnapshot()
    const normal = menuClassSource(base)
    expect(normal).not.toContain('.dumpVariables()')
    expect(normal).toMatch(/function dumpVariables\(\) \{\n    \}/)
  })
})

const sample = resolve(__dirname, '../../../samples/menu-nodes')
const load = async () => {
  const project = await loadProject(sample)
  const s = project.swfs['menu']!
  const nodes = (s.overlay as { nodes: Record<string, { instanceName?: string; role?: string; list?: unknown }> }).nodes
  return {
    ir: Swf.parse(s.ir), graphs: Object.values(s.graphs ?? {}),
    instanceNames: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : []))),
    roles: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.role ? [[id, o.role]] : []))),
    lists: listSettings(nodes)
  }
}

describe('generate() of samples/menu-nodes', () => {
  it('dev SWF has the hooks, the normal game SWF and the preview do not', async () => {
    const s = await load()
    const opts = { modId: 'InkwellMenuNodes', instanceNames: s.instanceNames, roles: s.roles, lists: s.lists, graphs: { graphs: s.graphs, packs } }
    const text = (o: object): string => generate(s.ir, { ...opts, ...o }).as2.map((f) => f.source).join('\n')
    const dev = text({ dev: true })
    expect(dev).toContain('this.graphs[k].dumpVariables();')
    expect(dev).toContain('__g.bridge.watch(')
    expect(dev).toContain('this.bridge.pin(nodeId, pin, v);')
    for (const flavour of [{}, { preview: true }, { dev: true, preview: true }]) {
      const t = text(flavour)
      expect(t).not.toContain('bridge.pin(')
      expect(t).not.toContain('bridge.watch(')
      expect(t).not.toContain('.dumpVariables()')
    }
  })
})

const ffdecDir = process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
const javaPath = process.env['INKWELL_JAVA'] ?? 'java'
const jarPath = resolve(__dirname, '../../../tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const hasJava = (() => {
  try {
    execFileSync(javaPath, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const can = hasJava && existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath) && existsSync(join(ffdecDir, 'ffdec-cli.jar'))
if (!can) console.warn(`[dev codegen FFDec test] SKIPPED: Java=${hasJava} FFDec=${existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar'))} wrapper jar=${existsSync(jarPath)}`)

describe.skipIf(!can)('dev SWF with the real FFDec', () => {
  it('compiles: the AS2 parses and the hooks are in the bytecode', async () => {
    const s = await load()
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-dev-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const r = await compileSwf(s.ir, { modId: 'InkwellMenuNodes', buildDir: dir, ffdec, instanceNames: s.instanceNames, roles: s.roles, lists: s.lists, graphs: { graphs: s.graphs, packs }, dev: true })
      expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
      const xml = join(dir, 'swf.xml')
      execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', r.swfPath, xml], { stdio: 'ignore' })
      const text = readFileSync(xml, 'utf8')
      for (const w of ['dumpVariables', 'watch', 'pin']) expect(text).toContain(Buffer.from(w).toString('hex'))
    } finally {
      ffdec.stop()
    }
  }, 120_000)
})
