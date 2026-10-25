// Graph-driven widgets without FFDec: the generated AS2 classes and the Papyrus API from On Widget Call. The FFDec/Papyrus end-to-end run is graphWidget.integration.test.ts.
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { defIndex } from '../../shared/graphs'
import { validateGraph } from '../../shared/graphValidate'
import { loadCodegenPacks } from '../codegen/packs'
import { corePack, graph, node, wire } from '../codegen/codegen.testutil'
import { loadPacks } from '../packs'
import { loadProject } from '../project'
import { generate } from '../swf/generate'
import { generateScripts } from './papyrus'
import { compilePapyrus } from './papyrusCompiler'

const sample = resolve(__dirname, '../../../samples/hud-graph')
const placement = { hAnchor: 'right', vAnchor: 'top', x: 1253.333, y: 26.667, alpha: 100 } as const
const papyrusExe = process.env['INKWELL_PAPYRUS'] && existsSync(process.env['INKWELL_PAPYRUS']) ? process.env['INKWELL_PAPYRUS'] : undefined

const load = async () => {
  const project = await loadProject(sample)
  const s = project.swfs['hud']!
  const { packs } = await loadCodegenPacks([corePack])
  return { project, ir: Swf.parse(s.ir), graphs: Object.values(s.graphs ?? {}), packs, overlay: s.overlay as { nodes: Record<string, { instanceName?: string }> } }
}

describe('samples/hud-graph', () => {
  it('has no graph validation issues against the core pack', async () => {
    const { ir, graphs } = await load()
    const defs = defIndex(await loadPacks([corePack]))
    expect(graphs).toHaveLength(1)
    expect(validateGraph(graphs[0]!, { defs, layers: new Set(Object.keys(ir.nodes)), siblings: graphs })).toEqual([])
  })

  it('compiles to a graph class on the widget clip, with the On Widget Call signature and the target resolved by instance name', async () => {
    const { project, ir, graphs, packs, overlay } = await load()
    const instanceNames = Object.fromEntries(Object.entries(overlay.nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : [])))
    const g = generate(ir, { modId: project.meta.modId, instanceNames, widget: true, graphs: { graphs, packs } })
    expect(g.lint.filter((l) => l.severity === 'error')).toEqual([])
    expect(g.graphCalls).toEqual([{ name: 'Show', params: [{ name: 'title', type: 'String' }] }])
    const cls = g.as2.find((f) => f.path.endsWith('HudGraph_main.as'))!
    expect(cls.source).toContain('__g.base.title.text = call_title;')
    expect(cls.source).toContain('if ((call_title != ""))')
    expect(cls.source).toContain('trace("[Inkwell] info log: " + "shown");')
    // the frame code creates the instance on the widget clip after the SkyUI contract is installed
    const frame = g.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source
    expect(frame.indexOf('Widget.install(widget)')).toBeLessThan(frame.indexOf('new mods.InkwellGraphTest.HudGraph_main(widget)'))
    // a graph-driven widget has no hardcoded popup API
    expect(g.as2.find((f) => f.path.endsWith('HudWidget.as'))!.source).not.toContain('setTexts')
    expect(g.graphClasses[0]!.map.lines).not.toEqual({})
  })

  it('Papyrus: one typed function per On Widget Call, the string-array transport, Test() and the hotkey kept', async () => {
    const { graphs } = await load()
    const calls = [{ name: 'Show', params: [{ name: 'title', type: 'String' as const }] }]
    expect(graphs).toHaveLength(1)
    const src = generateScripts({ modId: 'InkwellGraphTest', widgetName: 'Hud', displayName: 'Graph', placement, calls, debugHotkey: 65 })[0]!.source
    expect(src).toContain('Function Show(String asTitle)')
    expect(src).toContain('UI.InvokeStringA("HUD Menu", WidgetRoot + ".Show", a)')
    expect(src).toContain('Function Test() global')
    expect(src).toContain('w.Show("Inkwell test")')
    expect(src).toContain('RegisterForKey(DebugHotkey)')
    expect(src).not.toContain('SetTexts')
    expect(src).toMatchSnapshot()
  })

  it('Papyrus: String, Number and Bool parameters and a function without parameters', () => {
    const calls = [
      { name: 'Popup', params: [{ name: 'title', type: 'String' as const }, { name: 'hold', type: 'Number' as const }, { name: 'sticky', type: 'Bool' as const }] },
      { name: 'Hide', params: [] }
    ]
    const src = generateScripts({ modId: 'M', widgetName: 'Hud', displayName: 'x', placement, calls })[0]!.source
    expect(src).toContain('Function Popup(String asTitle, Float afHold, Bool abSticky)')
    expect(src).toContain('a[1] = afHold as String')
    expect(src).toContain('UI.InvokeBool("HUD Menu", WidgetRoot + ".Hide", True)')
    expect(src).toMatchSnapshot()
  })

  it('refuses names Papyrus cannot take', () => {
    for (const name of ['Test', 'On_Key', 'x'])
      expect(() => generateScripts({ modId: 'M', widgetName: 'Hud', displayName: 'x', placement, calls: [{ name, params: [] }] })).toThrow(/On Widget Call/)
  })

  it.skipIf(!papyrusExe)('the generated Papyrus compiles with the real compiler', async () => {
    const calls = [
      { name: 'Popup', params: [{ name: 'title', type: 'String' as const }, { name: 'hold', type: 'Number' as const }, { name: 'sticky', type: 'Bool' as const }] },
      { name: 'Hide', params: [] }
    ]
    const scripts = generateScripts({ modId: 'M', widgetName: 'Hud', displayName: 'x', placement, calls, debugHotkey: 65 })
    const r = await compilePapyrus({ papyrusExe: papyrusExe!, scripts, workDir: mkdtempSync(join(tmpdir(), 'inkwell-pex-')) })
    expect(r.lint).toEqual([])
    expect(Object.keys(r.pex).sort()).toEqual(['M_Hud', 'M_HudInstance'])
  })
})

describe('no graph, nothing changes', () => {
  it('generate() output is identical without graphs, with an empty graph list, and with graphs=undefined', async () => {
    const { ir, packs } = await load()
    const a = generate(ir, { modId: 'M', widget: true })
    const b = generate(ir, { modId: 'M', widget: true, graphs: { graphs: [], packs } })
    expect(b.as2).toEqual(a.as2)
    expect(b.tags.map((t) => t.toString('hex'))).toEqual(a.tags.map((t) => t.toString('hex')))
    expect(a.graphClasses).toEqual([])
    expect(a.graphCalls).toEqual([])
  })

  it('a graph without On Widget Call keeps the hardcoded popup API', async () => {
    const { ir, packs } = await load()
    const g = graph('timer', [node('t', 'core/OnTimer@1', { seconds: 1, repeat: true }), node('l', 'core/Log@1', { message: 'tick' })], [wire('t', 'then', 'l', 'in')])
    const r = generate(ir, { modId: 'M', widget: true, settableTexts: new Set(['2:4']), graphs: { graphs: [g], packs } })
    expect(r.graphCalls).toEqual([])
    expect(r.as2.find((f) => f.path.endsWith('HudWidget.as'))!.source).toContain('setTexts')
    expect(r.as2.some((f) => f.path.endsWith('HudGraph_timer.as'))).toBe(true)
  })
})
