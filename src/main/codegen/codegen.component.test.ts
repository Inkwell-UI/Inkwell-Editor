import { describe, expect, it } from 'vitest'
import { newComponentGraph } from '../../shared/graphs'
import { generateGraphClasses } from './codegen'
import { graph, loadCore, node, wire } from './codegen.testutil'

const packs = await loadCore()

// a component's graph: On Load logs the prop `label` (Get Prop -> Log message)
const compGraph = () => ({
  ...newComponentGraph('5:1', 'ListItem'),
  props: [{ id: 'p1', name: 'label', type: 'String' as const, default: 'none' }, { id: 'p2', name: 'count', type: 'Number' as const }],
  nodes: [node('ol', 'core/OnLoad@1'), node('log', 'core/Log@1', { level: 'info' }), node('gp', 'core/GetProp@1', { prop: 'p1', propType: 'String', propName: 'label' })],
  edges: [wire('ol', 'then', 'log', 'in'), wire('gp', 'value', 'log', 'message')]
})
const gen = (...graphs: ReturnType<typeof compGraph>[] | ReturnType<typeof graph>[]) =>
  generateGraphClasses({ modId: 'M', swfCls: 'T', graphs: graphs as never, packs, layerPath: (id, g) => (g.scope === 'blueprint' ? (id === 'inner' ? 'title' : undefined) : id === 'root' ? '' : undefined) })

describe('component graph (blueprint)', () => {
  it('compiles to a class made per instance: (clip, props, owner), prop defaults filled in, Get Prop reads __g.props', () => {
    const r = gen(compGraph())
    expect(r.issues).toEqual([])
    const c = r.classes[0]!
    expect(c.component).toBe(true)
    expect(c.source).toContain('function TGraph__5_1(base, props, owner) {')
    expect(c.source).toContain('this.props = props == undefined ? {} : props;')
    expect(c.source).toContain('if (this.props["label"] == undefined) this.props["label"] = "none";')
    expect(c.source).toContain('if (this.props["count"] == undefined) this.props["count"] = 0;') // no default: the zero of the type
    expect(c.source).toContain('__g.props["label"]')
  })

  it('a layer is found by its path inside the component; a layer of the menu is not', () => {
    const g = { ...compGraph(), nodes: [node('ol', 'core/OnLoad@1'), node('st', 'core/SetText@1', { target: 'inner', text: 'hi' })], edges: [wire('ol', 'then', 'st', 'in')] }
    const r = gen(g)
    expect(r.classes[0]!.source).toContain('__g.base.title')
    const bad = gen({ ...g, nodes: [node('ol', 'core/OnLoad@1'), node('st', 'core/SetText@1', { target: 'menuLayer', text: 'hi' })] })
    expect(bad.issues.length).toBeGreaterThan(0)
  })

  it('a menu graph is unchanged: class(base) and no props', () => {
    const r = gen(graph('main', [node('ol', 'core/OnLoad@1')], []))
    expect(r.classes[0]!.component).toBeUndefined()
    expect(r.classes[0]!.source).toContain('function TGraph_main(base) {')
    expect(r.classes[0]!.source).not.toContain('this.props')
  })
})

describe('Create Component in a SWF', () => {
  it('attaches the component symbol under the parent layer and makes its class: (clip, props, __g).init()', async () => {
    const { generate } = await import('../swf/generate')
    const { frame, rectShape, swf } = await import('../swf/ir.testutil')
    const comp = { ...frame('5:1', ['5:2']), type: 'component', variants: [{ name: 'Default', node: '5:1' }] }
    const ir = swf([frame('f', ['s']), rectShape('s')])
    const menu = graph('main', [node('ol', 'core/OnLoad@1'), node('cc', 'core/CreateComponent@1', { component: '5:1', parent: 'f' })], [wire('ol', 'then', 'cc', 'in')])
    const g = generate(ir, { modId: 'M', graphs: { graphs: [menu, compGraph() as never], packs }, components: [{ id: '5:1', name: 'ListItem', nodes: { '5:1': comp as never, '5:2': { ...rectShape('5:2'), parent: '5:1' } } }] })
    expect(g.lint.filter((l) => l.severity === 'error')).toEqual([])
    const main = g.graphClasses.find((c) => c.graphId === 'main')!
    expect(main.source).toContain('.attachMovie("inkwell_component_5_1"')
    expect(main.source).toMatch(/\(new mods\.M\.\w+_5_1\(\w+_instance, \{\}, __g\)\)\.init\(\);/)
    expect(g.as2.some((f) => f.path.includes('/menu') || f.source.includes('inkwellGraph'))).toBe(true)
    // the component's class is not started by the frame code: only Create Component makes it
    expect(g.as2.find((f) => f.path === 'frame_1/DoAction.as')?.source ?? '').not.toContain('_5_1')
  })

  it('a component that was not compiled (no graph, or not on the page) is an error on the node, not broken AS2', async () => {
    const { generate } = await import('../swf/generate')
    const { frame, rectShape, swf } = await import('../swf/ir.testutil')
    const menu = graph('main', [node('ol', 'core/OnLoad@1'), node('cc', 'core/CreateComponent@1', { component: '9:9', parent: 'f' })], [wire('ol', 'then', 'cc', 'in')])
    const g = generate(swf([frame('f', ['s']), rectShape('s')]), { modId: 'M', graphs: { graphs: [menu], packs } })
    expect(g.lint.some((l) => l.severity === 'error' && l.message.includes('9:9'))).toBe(true)
  })

  it('an auto-layout parent named on Create Component lays its new instances out (frame registration + stackAdd), a wired parent does not', async () => {
    const { generate } = await import('../swf/generate')
    const { frame, rectShape, swf } = await import('../swf/ir.testutil')
    const comp = { ...frame('5:1', ['5:2']), type: 'component', variants: [{ name: 'Default', node: '5:1' }] }
    const parent = frame('p', ['d'], { autoLayout: { mode: 'vertical', spacing: 10, padding: [8, 8, 8, 8], primaryAlign: 'start', counterAlign: 'start', wrap: false } })
    const ir = swf([frame('f', ['p']), parent, { ...rectShape('d'), parent: 'p' }])
    const menu = graph('main', [node('ol', 'core/OnLoad@1'), node('cc', 'core/CreateComponent@1', { component: '5:1', parent: 'p' })], [wire('ol', 'then', 'cc', 'in')])
    const g = generate(ir, { modId: 'M', graphs: { graphs: [menu, compGraph() as never], packs }, components: [{ id: '5:1', name: 'ListItem', nodes: { '5:1': comp as never, '5:2': { ...rectShape('5:2'), parent: '5:1' } } }] })
    const frameCode = g.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source
    expect(frameCode).toMatch(/this\.frame_p\.inkwellStack = \{mode: 1, spacing: 10, pad: \[8, 8, 8, 8\], counter: 0, w: \d+, h: \d+, start: \d+\};/)
    expect(g.graphClasses.find((c) => c.graphId === 'main')!.source).toContain('function stackAdd(parent, clip, component)')
    expect(g.graphClasses.find((c) => c.graphId === 'main')!.source).toContain('__g.stackAdd(')
    // a graph with neither node gets no stack methods
    expect(generate(ir, { modId: 'M', graphs: { graphs: [graph('main', [node('ol', 'core/OnLoad@1')], [])], packs } }).graphClasses[0]!.source).not.toContain('stackAdd')
  })
})
