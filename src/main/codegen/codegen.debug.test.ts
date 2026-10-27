// Phase 6: data binding code, the Ruffle preview build (pin traces, mock data) and a node that throws.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NodeDef } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { generateGraphClasses, type CodegenInput } from './codegen'
import { graph, loadCore, node, wire } from './codegen.testutil'

const packs = await loadCore()
const layers: Record<string, string> = { L: 'title', R: '', B: 'bar' }
const gen = (g: ReturnType<typeof graph>, extra: Partial<CodegenInput> = {}) =>
  generateGraphClasses({ modId: 'M', swfCls: 'T', graphs: [g], packs, layerPath: (id) => layers[id], ...extra })
const src = (g: ReturnType<typeof graph>, extra: Partial<CodegenInput> = {}): string => gen(g, extra).classes[0]!.source
const call = node('e', 'core/OnWidgetCall@1', { name: 'Show', params: [{ name: 'title', type: 'String' }] })
const vars = [
  { id: 'score', name: 'score', type: 'Number', scope: 'menu', default: 5 },
  { id: 'label', name: 'label', type: 'String', scope: 'menu', default: 'x' }
] as never
const setScore = graph('b', [call, node('s', 'core/SetVariable@1', { variable: 'score' }), node('n', 'core/Arithmetic@1', { op: '+', a: 1, b: 2 })], [wire('e', 'then', 's', 'in'), wire('n', 'value', 's', 'value')], vars)

describe('data binding codegen', () => {
  const bindings = { L: 'text=var:label;alpha=var:score', B: 'visible=var:score;tint=var:score', R: 'alpha=var:score' }
  it('applies a bound variable to the properties on init and after every Set Variable', () => {
    const s = src(setScore, { bindings })
    expect(s).toContain('__g.b_score = function() {')
    expect(s).toContain('__g.base.title._alpha = Number(__g.v_score);')
    expect(s).toContain('__g.base.bar._visible = (__g.v_score == true || __g.v_score == "true");')
    expect(s).toContain('new Color(__g.base.bar).setRGB(Number(__g.v_score));')
    expect(s).toContain('__g.base._alpha = Number(__g.v_score);') // the base clip itself
    expect(s).toContain('__g.base.title.text = String(__g.v_label);')
    // applied once right after the variables are initialised ...
    expect(s.indexOf('__g.v_score = 5;')).toBeLessThan(s.indexOf('__g.b_score();'))
    // ... and again right after every Set Variable, before the rest of its chain
    const lines = s.split('\n')
    const set = lines.findIndex((l) => /^\s+__g\.v_score = /.test(l) && !l.includes('= 5;'))
    expect(set).toBeGreaterThan(0)
    expect(lines[set + 1]).toContain('__g.b_score();')
  })
  it('a variable nobody binds, a missing layer and an unparsable part change nothing', () => {
    const plain = src(setScore)
    expect(src(setScore, { bindings: { NOPE: 'text=var:score', L: 'text=var:ghost;weird' } })).toBe(plain)
    expect(plain).not.toContain('b_score')
  })
  it('a binding failure is caught and logged, not thrown', () => {
    expect(src(setScore, { bindings })).toMatch(/__g\.b_score = function\(\) \{\n\s+try \{[\s\S]*?\} catch \(e\) \{\n\s+__g\.fail\("binding:score", e\);/)
  })
  it('mock: bindings and mock-named variables exist in the preview build only', () => {
    const b = { L: 'text=mock:greeting;alpha=mock:hp.max' }
    expect(src(setScore, { bindings: b })).not.toContain('mock')
    const s = src(setScore, { bindings: b, preview: true })
    expect(s).toContain('var m = _global.Inkwell.mock;')
    expect(s).toContain('if (m["greeting"] != undefined) { __g.base.title.text = String(m["greeting"]); }')
    expect(s).toContain('m["hp.max"]') // keys that are not identifiers go through brackets
    expect(s).toContain('if (m["score"] != undefined) { __g.v_score = Number(m["score"]); }')
    expect(s).toContain('_global.Inkwell.mockListeners.push(__g.mock);')
  })
  it('a mock value for a bound variable re-applies its bindings', () => {
    expect(src(setScore, { bindings: { L: 'alpha=var:score' }, preview: true })).toContain('if (m["score"] != undefined) { __g.v_score = Number(m["score"]); __g.b_score(); }')
  })
})

describe('preview build (debug traces)', () => {
  const g = graph('p', [call, node('c', 'core/Compare@1', { valueType: 'String', op: '!=' }), node('br', 'core/Branch@1', {}), node('log', 'core/Log@1', { level: 'info', message: 'shown' })], [
    wire('e', 'then', 'br', 'in'), wire('e', 'title', 'c', 'a'), wire('c', 'value', 'br', 'condition'), wire('br', 'true', 'log', 'in')
  ])
  it('is the same class plus pin traces on pure outputs and handler parameters', () => {
    const s = src(g, { preview: true })
    expect(s).toContain('function pv(nodeId, pin, v) {')
    expect(s).toContain('trace("[Inkwell] pin " + nodeId + "." + pin + " = " + s);')
    expect(s).toMatch(/__g\.pv\("c", "value", \(?e_title != ""\)?\)/)
    expect(s).toContain('__g.pv("e", "title", e_title);')
  })
  it('every exec node reports that it ran: the entry at the start of its handler, the others right after their header', () => {
    const s = src(g, { preview: true })
    expect(s).toContain('function rn(nodeId) {')
    expect(s).toContain('trace("[Inkwell] run " + nodeId);')
    expect(s).toMatch(/__g\.Show = function\(e_title:String\) \{\s+try \{\s+__g\.rn\("e"\);/)
    expect(s).toMatch(/\/\/ \[br\] core\/Branch@1\s+__g\.rn\("br"\);/)
    expect(s).toMatch(/\/\/ \[log\] core\/Log@1\s+__g\.rn\("log"\);/)
    expect(s).not.toContain('__g.rn("c")') // a pure node has no run, its value badge is its trace
    const c = gen(g, { preview: true }).classes[0]!
    const lines = c.source.split('\n')
    expect(c.map.lines[String(lines.findIndex((l) => l.includes('__g.rn("br")')) + 1)]).toBe('br')
  })
  it('Delay and Cancel Delay report their timer (the definition names the input and the key field)', () => {
    const t = graph('t', [call, node('d', 'core/Delay@1', { name: 'slow' }), node('d2', 'core/Delay@1', {}), node('x', 'core/CancelDelay@1', { name: 'slow' }), node('log', 'core/Log@1', { level: 'info', message: 'late' })], [
      wire('e', 'then', 'd', 'in'), wire('d', 'then', 'x', 'in'), wire('x', 'then', 'd2', 'in'), wire('d2', 'then', 'log', 'in')
    ])
    const s = src(t, { preview: true })
    expect(s).toContain('__g.wt("d", "slow", 1 * 1000);')
    expect(s).toContain('__g.wt("d2", "d2", 1 * 1000);') // unnamed: the node id is the key
    expect(s).toContain('__g.wx("slow");')
    expect(s).toMatch(/try \{\s+__g\.wf\("d"\);/) // the continuation reports first
    expect(s).toContain('function wt(nodeId, key, ms) {')
    expect(src(t)).not.toMatch(/__g\.w[tfx]\(/)
  })
  it('the game build has none of it', () => {
    const s = src(g)
    expect(s).not.toContain('rn(')
    expect(s).not.toContain('pv(')
    expect(s).not.toContain('mock')
    expect(s).toBe(src(g, { preview: false }))
  })
  it('traced lines map to the node they trace', () => {
    const c = gen(g, { preview: true }).classes[0]!
    const lines = c.source.split('\n')
    const at = (re: RegExp): string | undefined => c.map.lines[String(lines.findIndex((l) => re.test(l)) + 1)]
    expect(at(/__g\.pv\("e", "title"/)).toBe('e')
    expect(at(/function pv/)).toBeUndefined()
  })
  it('the Log line has the format the trace panel parses', () => {
    expect(src(g)).toContain('trace("[Inkwell] info log: " + "shown")')
  })
})

describe('a node that throws (test-only core/Throw@1)', () => {
  const dir = resolve(__dirname, '../../../tests/fixtures/packs/throw-node')
  const def = JSON.parse(readFileSync(resolve(dir, 'nodes/Throw.json'), 'utf8')) as NodeDef
  const withThrow = {
    defs: new Map([...packs.defs, ['core/Throw@1', def]]),
    templates: new Map([...packs.templates, ['core/Throw@1', readFileSync(resolve(dir, 'templates/Throw.as2'), 'utf8')]])
  }
  const build = (g: ReturnType<typeof graph>): string => generateGraphClasses({ modId: 'M', swfCls: 'T', graphs: [g], packs: withThrow, layerPath: (id) => layers[id] }).classes[0]!.source
  const g = graph('t', [
    node('e', 'core/OnWidgetCall@1', { name: 'Boom', params: [] }),
    node('x', 'core/Throw@1', { message: 'kaboom' }),
    node('after', 'core/Log@1', { level: 'info', message: 'not reached' })
  ], [wire('e', 'then', 'x', 'in'), wire('x', 'then', 'after', 'in')])
  it('the handler is a try/catch that logs through fail(), which names the throwing node', () => {
    const s = build(g)
    expect(s).toContain('throw { node: "x", message: "kaboom" };')
    expect(s).toMatch(/try \{[\s\S]*throw \{ node: "x"[\s\S]*\} catch \(e\) \{\s+__g\.fail\("e", e\);/)
    expect(s).toContain('if (e.node != undefined) nodeId = e.node;') // the thrown object's node wins over the entry
    expect(s).toContain('var line = "[Inkwell] error " + nodeId + ": " + msg;')
  })
  it('each entry has its own try/catch, so one failing handler leaves the others working', () => {
    const t = build(graph('t2', [...g.nodes, node('e2', 'core/OnWidgetCall@1', { name: 'Fine', params: [] }), node('ok', 'core/Log@1', { level: 'info', message: 'still works' })], [...g.edges, wire('e2', 'then', 'ok', 'in')]))
    expect(t.split('__g.fail("e", e)')).toHaveLength(2)
    expect(t.split('__g.fail("e2", e)')).toHaveLength(2)
  })
})
