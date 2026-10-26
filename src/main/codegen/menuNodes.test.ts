// Phase 5b: samples/menu-nodes (saved scope S5, list component S8, runtime event nodes S7). Golden AS2 and lint without FFDec; the real FFDec compile is the second describe
// (skipped without Java, FFDec or the wrapper jar). What the AS2 DOES is the Ruffle run (`INKWELL_SHOTS_MENU=nodes`, src/main/screenshotMenu.ts).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { defIndex } from '../../shared/graphs'
import { validateGraph } from '../../shared/graphValidate'
import { listSettings } from '../../shared/overlay'
import { loadPacks } from '../packs'
import { loadProject } from '../project'
import { compileSwf } from '../swf/compile'
import { generate } from '../swf/generate'
import { generateGraphClasses } from './codegen'
import { corePack, graph, node, wire } from './codegen.testutil'
import { loadCodegenPacks } from './packs'

const sample = resolve(__dirname, '../../../samples/menu-nodes')
const load = async () => {
  const project = await loadProject(sample)
  const s = project.swfs['menu']!
  const { packs } = await loadCodegenPacks([corePack])
  const nodes = (s.overlay as { nodes: Record<string, { instanceName?: string; role?: string; list?: unknown }> }).nodes
  return {
    project, ir: Swf.parse(s.ir), graphs: Object.values(s.graphs ?? {}), packs,
    instanceNames: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : []))),
    roles: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.role ? [[id, o.role]] : []))),
    lists: listSettings(nodes)
  }
}

describe('saved scope codegen (S5.4)', async () => {
  const { packs } = await loadCodegenPacks([corePack])
  const saved = (type: string, def: unknown) => [{ id: 'v1', name: 'count', type, scope: 'saved', default: def }] as never
  const g = (type = 'Number', def: unknown = 0) =>
    graph('m', [node('e', 'core/OnOpen@1'), node('s', 'core/SetVariable@1', { variable: 'v1' }), node('t', 'core/Toggle@1', { variable: 'v1' }), node('l', 'core/Log@1', { level: 'info' })],
      [wire('e', 'then', 's', 'in'), wire('s', 'then', 't', 'in'), wire('t', 'then', 'l', 'in')], saved(type, def))
  const gen = (graphs: ReturnType<typeof g>[], menu: boolean) => generateGraphClasses({ modId: 'M', swfCls: 'T', graphs, packs, layerPath: () => undefined, ...(menu ? { menu: true } : {}) })
  it('init reads the stored value with a type check; each assigning node writes it back before its continuation', () => {
    const src = gen([g()], true).classes[0]!.source
    expect(src).toContain('__g.v_count = __g.bridge.getSaved("count", 0);')
    expect(src).toContain('if (typeof (__g.v_count) != "number" || isNaN(__g.v_count)) {')
    expect(src).toContain('__g.v_count = 0;')
    const set = src.indexOf('core/SetVariable@1')
    const tog = src.indexOf('core/Toggle@1')
    const w1 = src.indexOf('__g.bridge.setSaved("count", __g.v_count);', set)
    expect(w1).toBeGreaterThan(src.indexOf('__g.v_count = ', set + 10))
    expect(w1).toBeLessThan(tog)
    expect(src.indexOf('__g.bridge.setSaved("count", __g.v_count);', tog)).toBeGreaterThan(src.indexOf('= !(', tog))
    expect(src.match(/setSaved/g)).toHaveLength(2)
    expect(src).toMatchSnapshot()
  })
  it('Bool and String check their own typeof; a graph without the menu flavour has no bridge calls', () => {
    expect(gen([g('Bool', false)], true).classes[0]!.source).toContain('typeof (__g.v_count) != "boolean")')
    expect(gen([g('String', '')], true).classes[0]!.source).toContain('typeof (__g.v_count) != "string")')
    const plain = gen([g()], false).classes[0]!.source
    expect(plain).not.toContain('getSaved')
    expect(plain).not.toContain('setSaved')
  })
})

describe('samples/menu-nodes', async () => {
  const s = await load()
  const defs = defIndex(await loadPacks([corePack]))
  const layers = new Set(Object.keys(s.ir.nodes))
  it('is clean as a custom menu; in a HUD widget its runtime nodes and the saved variable are runtime-required warnings', () => {
    expect(validateGraph(s.graphs[0]!, { defs, layers, siblings: s.graphs, target: 'customMenu' })).toEqual([])
    const hud = validateGraph(s.graphs[0]!, { defs, layers, siblings: s.graphs, target: 'hudWidget' })
    expect(hud.every((i) => i.code === 'runtime-required')).toBe(true)
    expect(hud.map((i) => i.nodeId)).toEqual(expect.arrayContaining(['modev', 'send', 'snd', 'gset', 'dev', 'clickc']))
    expect(hud.some((i) => i.message.includes('saved variable "clicks"'))).toBe(true)
  })
  it('a saved variable outside a custom menu, with a wrong type or a too long name is an error', () => {
    const g = s.graphs[0]!
    const bad = { ...g, scope: 'component' as const }
    expect(validateGraph(bad, { defs, layers, target: 'customMenu' }).map((i) => i.code)).toContain('saved-variable-invalid')
    const arr = { ...g, variables: [{ ...g.variables[0]!, type: 'Array' as const }] }
    expect(validateGraph(arr, { defs, layers, target: 'customMenu' }).map((i) => i.message).join(' ')).toContain('Bool, Number or String')
    const long = { ...g, variables: [{ ...g.variables[0]!, name: 'x'.repeat(65) }] }
    expect(validateGraph(long, { defs, layers, target: 'customMenu' }).map((i) => i.code)).toContain('saved-variable-invalid')
  })
  const gen = (preview = false) => generate(s.ir, { modId: 'InkwellMenuNodes', instanceNames: s.instanceNames, roles: s.roles, lists: s.lists, graphs: { graphs: s.graphs, packs: s.packs }, ...(preview ? { preview: true } : {}) })
  it('compiles without errors; the list class, its attach call and the menu class forwarding input', () => {
    const g = gen()
    expect(g.lint.filter((l) => l.severity === 'error')).toEqual([])
    const list = g.as2.find((f) => f.path.endsWith('InkwellList.as'))!.source
    for (const m of ['function setItems(', 'function refresh()', 'clip.getSelectedIndex = ', 'clip.getItem = ', 'clip.addEventListener = ', 'this.fire("change"', 'this.fire("itemClick"', 'onMouseWheel']) expect(list).toContain(m)
    expect(list).toMatchSnapshot()
    const frame = g.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source
    expect(frame).toContain('mods.InkwellMenuNodes.InkwellList.attach(this, "list", "row", 600, 100, 0, 0, 600, 46, 4, ["label"], ["label"]);')
    expect(frame.indexOf('InkwellList.attach')).toBeLessThan(frame.indexOf('_root.inkwellMenu.start()'))
    expect(g.as2.find((f) => f.path.endsWith('MenuMenu.as'))!.source).toContain('mods.InkwellMenuNodes.InkwellList.input(action);')
    const graphSrc = g.as2.find((f) => f.path.endsWith('MenuGraph_main.as'))!.source
    expect(graphSrc).toContain('__g.addModEventHandler("InkwellMenuNodes_Ping", function(strArg, numArg) {')
    expect(graphSrc).toContain('addEventListener("itemClick", __g, "h_sel");')
    expect(graphSrc).toContain('__g.bridge.playSound("UIMenuOK")')
  })
  it('the preview SWF gets the Play panel callbacks for mod events, messages, input and reopen', () => {
    const frame = gen(true).as2.find((f) => f.path === 'frame_1/DoAction.as')!.source
    for (const c of ['inkwellModEvent', 'inkwellMessage', 'inkwellInput', 'inkwellMenuReopen']) expect(frame).toContain(`"${c}"`)
    expect(frame).toContain('mods.InkwellMenuNodes.InkwellList.attach(_root, "list"')
  })
  it('a list without a frame template is an error; a missing configured template falls back with a warning', () => {
    const ir = structuredClone(s.ir)
    ir.nodes['2:3'] = { ...ir.nodes['2:3']!, children: [] } as never
    expect(generate(ir, { modId: 'M', roles: s.roles, lists: s.lists }).lint.map((l) => l.code)).toContain('list-template-invalid')
    const w = generate(s.ir, { modId: 'M', roles: s.roles, lists: { '2:3': { itemTemplate: 'nope' } } }).lint
    expect(w.find((l) => l.code === 'list-template-invalid')?.severity).toBe('warning')
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
if (!can) console.warn(`[menu nodes FFDec test] SKIPPED: Java=${hasJava} FFDec=${existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar'))} wrapper jar=${existsSync(jarPath)}`)

describe.skipIf(!can)('samples/menu-nodes with the real FFDec', () => {
  for (const preview of [false, true])
    it(`${preview ? 'preview' : 'game'} SWF compiles: list class, saved variable, runtime events`, async () => {
      const s = await load()
      const dir = mkdtempSync(join(tmpdir(), 'inkwell-nodes-'))
      const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
      try {
        const r = await compileSwf(s.ir, { modId: 'InkwellMenuNodes', buildDir: dir, ffdec, instanceNames: s.instanceNames, roles: s.roles, lists: s.lists, graphs: { graphs: s.graphs, packs: s.packs }, ...(preview ? { preview: true } : {}) })
        expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
        const xml = join(dir, 'swf.xml')
        execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', r.swfPath, xml], { stdio: 'ignore' })
        const text = readFileSync(xml, 'utf8')
        expect(text).toContain('__Packages.mods.InkwellMenuNodes.InkwellList')
        expect(text).toContain(Buffer.from('getSaved').toString('hex'))
        expect(text).toContain(Buffer.from('addModEventHandler').toString('hex'))
      } finally {
        ffdec.stop()
      }
    }, 120_000)
})
