// samples/hud-graph-popup: the popup rebuilt as a graph plus the "nodes" test graph (Phase 7). No FFDec needed; the real build is graphPopup.integration.test.ts.
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { defIndex } from '../../shared/graphs'
import { validateGraph } from '../../shared/graphValidate'
import { corePack } from '../codegen/codegen.testutil'
import { loadCodegenPacks } from '../codegen/packs'
import { loadPacks } from '../packs'
import { loadProject } from '../project'
import { generate } from '../swf/generate'
import { generateScripts } from './papyrus'
import { compilePapyrus } from './papyrusCompiler'

const sample = resolve(__dirname, '../../../samples/hud-graph-popup')
const placement = { hAnchor: 'right', vAnchor: 'top', x: 1253.333, y: 26.667, alpha: 100 } as const
const papyrusExe = process.env['INKWELL_PAPYRUS'] && existsSync(process.env['INKWELL_PAPYRUS']) ? process.env['INKWELL_PAPYRUS'] : undefined

const load = async () => {
  const project = await loadProject(sample)
  const s = project.swfs['hud']!
  const { packs } = await loadCodegenPacks([corePack])
  const overlay = s.overlay as { nodes: Record<string, { instanceName?: string }> }
  const instanceNames = Object.fromEntries(Object.entries(overlay.nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : [])))
  const ir = Swf.parse(s.ir)
  const g = generate(ir, { modId: project.meta.modId, instanceNames, widget: true, graphs: { graphs: Object.values(s.graphs ?? {}), packs } })
  return { project, ir, graphs: Object.values(s.graphs ?? {}), g }
}

describe('samples/hud-graph-popup', () => {
  it('all three graphs validate against the core pack', async () => {
    const { ir, graphs } = await load()
    const defs = defIndex(await loadPacks([corePack]))
    expect(graphs.map((x) => x.id).sort()).toEqual(['extras', 'main', 'nodes'])
    for (const gr of graphs) expect(validateGraph(gr, { defs, layers: new Set(Object.keys(ir.nodes)), siblings: graphs }), gr.id).toEqual([])
  })

  it('compiles without issues; the popup graph hides the card on load and shows/hides it with Fade', async () => {
    const { g } = await load()
    expect(g.lint.filter((l) => l.severity === 'error' || l.code === 'graph-codegen')).toEqual([])
    expect(g.graphCalls.map((c) => c.name)).toEqual(['Extras', 'Show', 'Hide', 'Nodes']) // graph ids sort: the hotkey and Test() start with Extras, then Show
    expect(g.graphCalls[1]!.params).toEqual([{ name: 'title', type: 'String' }, { name: 'description', type: 'String' }, { name: 'hold', type: 'Number' }])
    const main = g.as2.find((f) => f.path.endsWith('HudGraph_main.as'))!.source
    expect(main).toContain('if (__g.onLoad != undefined) __g.onLoad();')
    expect(main).toContain('__g.base.card._visible = false;')
    expect(main).toContain('setInterval(')
    expect(main).toContain('__g.base.card.title.text = show_title;')
    const extras = g.as2.find((f) => f.path.endsWith('HudGraph_extras.as'))!.source
    expect(extras).toContain('__g.ctr["extras"]')
    expect(extras).toContain('__g.tw.push(')
    expect(extras).toContain('clearInterval(__g.dl[')
    const nodes = g.as2.find((f) => f.path.endsWith('HudGraph_nodes.as'))!.source
    expect(nodes).toContain('throw { node: "throw"')
    expect(nodes).toContain('__g.base.report.status.text')
  })

  it('Papyrus: Extras(), Show(String, String, Float), Hide(), Nodes(Bool); calls before Ready are remembered and replayed; Test() calls Extras, the hotkey cycles Extras, Show, Hide, Nodes(False), Nodes(True)', async () => {
    const { g } = await load()
    const src = generateScripts({ modId: 'InkwellGraphPopup', widgetName: 'Hud', displayName: 'Popup', placement, calls: g.graphCalls, debugHotkey: 65 })[0]!.source
    expect(src).toContain('Function Show(String asTitle, String asDescription, Float afHold)')
    expect(src).toContain('Function Extras()')
    expect(src).toContain('Function Hide()')
    expect(src).toContain('Function Nodes(Bool abFail)')
    expect(src).toContain('_pendingCall = "Show"')
    expect(src).toContain('If c == "Show"')
    expect(src).toContain('ElseIf c == "Nodes"')
    expect(src).toContain('ElseIf s == 3') // the hotkey cycles Extras, Show, Hide, Nodes(False), Nodes(True)
    expect(src).toContain('w.Extras()') // Test() calls the first entry
    expect(src).toContain('Show("Inkwell test", "Text 2, shown by the InkwellGraphPopup_Hud test", 4.0)') // hotkey step 1
    expect(src).toMatchSnapshot()
  })

  it.skipIf(!papyrusExe)('the generated Papyrus compiles with the real compiler', async () => {
    const { g } = await load()
    const scripts = generateScripts({ modId: 'InkwellGraphPopup', widgetName: 'Hud', displayName: 'Popup', placement, calls: g.graphCalls, debugHotkey: 65 })
    const r = await compilePapyrus({ papyrusExe: papyrusExe!, scripts, workDir: mkdtempSync(join(tmpdir(), 'inkwell-pex-')) })
    expect(r.lint).toEqual([])
    expect(Object.keys(r.pex).sort()).toEqual(['InkwellGraphPopup_Hud', 'InkwellGraphPopup_HudInstance'])
  })
})
