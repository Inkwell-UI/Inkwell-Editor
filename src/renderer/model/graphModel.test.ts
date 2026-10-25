import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Graph } from '@inkwell-ui/spec'
import { loadPacks } from '../../main/packs'
import { defIndex, emptyGraph } from '../../shared/graphs'
import { toFlow } from '../state/graphStore'
import {
  categoriesOf, connectionRule, eventNodes, fieldRows, layerChoices, layerOptions, nodePins, nodeTarget, spawnDefs, spawnFor, spawnWire, type Defs
} from './graphModel'

const defs: Defs = defIndex(await loadPacks([resolve(__dirname, '../../../resources/packs/core')]))

const node = (id: string, kind: string, fields: Record<string, unknown> = {}) => ({ id, kind: `core/${kind}@1`, fields, pos: { x: 0, y: 0 } })
const build = (nodes: ReturnType<typeof node>[], edges: [string, string, string, string][] = [], variables: Graph['variables'] = []) => {
  const g: Graph = { ...emptyGraph('g', 'G', 'menu'), nodes, edges: edges.map(([a, p, b, q]) => ({ from: { node: a, pin: p }, to: { node: b, pin: q } })), variables }
  return toFlow(g)
}
const link = (s: string, sp: string, t: string, tp: string) => ({ source: s, sourceHandle: `${sp}-out`, target: t, targetHandle: `${tp}-in` })

describe('connection rules', () => {
  const g = build(
    [node('call', 'OnWidgetCall', { params: [{ name: 'title', type: 'String' }, { name: 'n', type: 'Number' }] }), node('set', 'SetText'), node('set2', 'SetText'), node('br', 'Branch'), node('log', 'Log'), node('cmp', 'Compare', { valueType: 'String' }), node('num', 'Arithmetic')],
    [['call', 'then', 'set', 'in'], ['call', 'title', 'set', 'text']]
  )
  const rule = connectionRule(defs, () => [])
  const ok = (l: ReturnType<typeof link>) => rule(g.nodes, g.edges, l)

  it('accepts exec to exec and equal or coercible data types', () => {
    expect(ok(link('set', 'then', 'br', 'in'))).toBeNull()
    expect(ok(link('call', 'n', 'set2', 'text'))).toBeNull() // Number -> String coerces
    expect(ok(link('cmp', 'value', 'br', 'condition'))).toBeNull() // Bool -> Bool
  })
  it('refuses what the Spec pinCompat refuses, and exec mixed with data', () => {
    expect(ok(link('call', 'title', 'num', 'a'))).toMatch(/String cannot connect to Number/) // needs To Number
    expect(ok(link('cmp', 'value', 'set2', 'in'))).toMatch(/Exec/)
    expect(ok(link('call', 'then', 'br', 'condition'))).toMatch(/Exec/)
  })
  it('refuses a self link, a missing pin and an unknown pack node', () => {
    expect(ok(link('set', 'then', 'set', 'in'))).toMatch(/itself/)
    expect(ok(link('set', 'nope', 'br', 'in'))).toBe('No such pin')
    const u = build([node('a', 'Log'), { id: 'x', kind: 'other/Thing@1', fields: {}, pos: { x: 0, y: 0 } }])
    expect(rule(u.nodes, u.edges, link('a', 'then', 'x', 'in'))).toMatch(/Unknown pack node/)
  })
  it('an exec output and a data input take one wire', () => {
    expect(ok(link('call', 'then', 'log', 'in'))).toMatch(/exec output already/)
    expect(ok(link('call', 'n', 'set', 'text'))).toMatch(/input already has a wire/)
    expect(ok(link('set', 'then', 'set2', 'in'))).toBeNull() // several wires INTO an exec input are fine
  })
  it('refuses an exec loop, but not a data wire that happens to point back', () => {
    const loop = build([node('a', 'Log'), node('b', 'Log'), node('c', 'Log')], [['a', 'then', 'b', 'in'], ['b', 'then', 'c', 'in']])
    expect(rule(loop.nodes, loop.edges, link('c', 'then', 'a', 'in'))).toMatch(/loop/)
    expect(rule(loop.nodes, loop.edges, link('c', 'then', 'b', 'in'))).toMatch(/loop/)
  })
  it('reads dynamic pins: On Widget Call params are outputs, a retyped Compare takes strings', () => {
    expect(nodePins(defs, g.nodes[0]!, [])!.outputs.map((p) => `${p.name}:${p.type}`)).toEqual(['then:Exec', 'title:String', 'n:Number'])
    expect(ok(link('call', 'title', 'cmp', 'a'))).toBeNull()
  })
})

describe('spawn menu', () => {
  const g = build([node('call', 'OnWidgetCall', { params: [{ name: 'title', type: 'String' }] }), node('set', 'SetText'), node('log', 'Log')], [['call', 'then', 'set', 'in']])
  const sdefs = spawnDefs(defs)
  const run = (from: Parameters<typeof spawnFor>[0]['from']) => spawnFor({ defs, spawn: sdefs, nodes: g.nodes, edges: g.edges, vars: [], from })

  it('offers every node type without a wire, ordered by category', () => {
    const all = run(null)
    expect(all).toHaveLength(defs.size)
    expect(all[0]!.def.category).toBe('Events')
    expect(categoriesOf(defs).map((c) => c.id).slice(0, 3)).toEqual(['Events', 'Flow', 'Variables'])
  })
  it('from a free Exec output: only nodes with an Exec input', () => {
    const o = run({ nodeId: 'set', handle: 'then-out', type: 'source' })
    expect(o.length).toBeGreaterThan(0)
    expect(o.every((x) => x.pin?.startsWith('Exec:'))).toBe(true)
    expect(o.some((x) => x.def.kind === 'core/Branch@1')).toBe(true)
    expect(o.some((x) => x.def.kind === 'core/GetText@1')).toBe(false)
  })
  it('an Exec output that already has a wire offers nothing (the rule refuses it)', () => {
    expect(run({ nodeId: 'call', handle: 'then-out', type: 'source' })).toEqual([])
  })
  it('from a String output: nodes with a String input, each pin once; from an input: nodes with a matching output', () => {
    const o = run({ nodeId: 'call', handle: 'title-out', type: 'source' })
    expect(o.find((x) => x.def.kind === 'core/Log@1' && x.pin === 'String:message')).toBeTruthy()
    expect(o.every((x) => x.pin?.startsWith('String:'))).toBe(true)
    const i = run({ nodeId: 'log', handle: 'message-in', type: 'target' })
    expect(i.some((x) => x.def.kind === 'core/Concat@1' && x.pin === 'String:value')).toBe(true)
    expect(i.every((x) => x.pin?.startsWith('String:'))).toBe(true)
  })
  it('a picked option wires the new node the right way round', () => {
    expect(spawnWire({ nodeId: 'a', handle: 'then-out', type: 'source' }, 'n', { pin: 'Exec:in' })).toEqual({ from: { node: 'a', pin: 'then' }, to: { node: 'n', pin: 'in' } })
    expect(spawnWire({ nodeId: 'a', handle: 'text-in', type: 'target' }, 'n', { pin: 'String:value' })).toEqual({ from: { node: 'n', pin: 'value' }, to: { node: 'a', pin: 'text' } })
    expect(spawnWire(null, 'n', { pin: undefined })).toBeUndefined()
  })
})

describe('inline fields', () => {
  const pinsFor = (n: { id: string; kind: string; fields: Record<string, unknown> }) => nodePins(defs, { data: n as never }, [])!
  it('an unwired component pin is a layer picker, a wired one has no editor', () => {
    const n = node('s', 'SetText', { target: '2:4' })
    const rows = fieldRows(defs.get(n.kind)!, { data: n as never }, pinsFor(n), new Set())
    expect(rows.map((r) => [r.key, r.kind])).toEqual([['target', 'layer'], ['text', 'string']])
    expect(rows[0]).toMatchObject({ value: '2:4', pinType: 'Text' })
    expect(fieldRows(defs.get(n.kind)!, { data: n as never }, pinsFor(n), new Set(['text', 'target'])).length).toBe(0)
  })
  it('pack fields: enums, params list, variable picker', () => {
    const cmp = node('c', 'Compare', { op: '!=' })
    expect(fieldRows(defs.get(cmp.kind)!, { data: cmp as never }, pinsFor(cmp), new Set(['a', 'b'])).map((r) => [r.key, r.kind, r.value])).toEqual([['valueType', 'enum', 'Number'], ['op', 'enum', '!=']])
    const ev = node('e', 'OnWidgetCall', { params: [{ name: 'x', type: 'Bool' }] })
    expect(fieldRows(defs.get(ev.kind)!, { data: ev as never }, pinsFor(ev), new Set()).map((r) => [r.key, r.kind])).toEqual([['name', 'string'], ['params', 'params']])
    const gv = node('v', 'GetVariable')
    expect(fieldRows(defs.get(gv.kind)!, { data: gv as never }, pinsFor(gv), new Set())[0]).toMatchObject({ key: 'variable', kind: 'variable' })
    const cm = node('m', 'Comment', { text: 'hi' })
    expect(fieldRows(defs.get(cm.kind)!, { data: cm as never }, pinsFor(cm), new Set())[0]).toMatchObject({ kind: 'text', value: 'hi' })
  })
  it('number and bool pins get number and checkbox editors', () => {
    const a = node('a', 'Arithmetic')
    expect(fieldRows(defs.get(a.kind)!, { data: a as never }, pinsFor(a), new Set()).filter((r) => r.key === 'a' || r.key === 'b').map((r) => r.kind)).toEqual(['number', 'number'])
    const b = node('b', 'Branch')
    expect(fieldRows(defs.get(b.kind)!, { data: b as never }, pinsFor(b), new Set()).map((r) => r.kind)).toEqual(['bool'])
  })
})

describe('layers', () => {
  const ir = {
    root: 'r',
    nodes: {
      r: { id: 'r', name: 'Hud', type: 'frame' },
      t: { id: 't', name: 'Title Text', type: 'text' },
      i: { id: 'i', name: 'Icon', type: 'image' },
      p: { id: 'p', name: 'panel', type: 'shape' }
    }
  } as never
  it('lists layers by instance name (overlay first), root excluded, sorted; pins filter by type', () => {
    const all = layerOptions(ir, { nodes: { t: { instanceName: 'title' } } })
    expect(all.map((l) => l.label)).toEqual(['Icon', 'panel', 'title'])
    expect(layerChoices(all, 'Text').map((l) => l.id)).toEqual(['t'])
    expect(layerChoices(all, 'Image').map((l) => l.id)).toEqual(['i'])
    expect(layerChoices(all, 'Clip')).toHaveLength(3)
  })
  it('a graph node refers to the layer of its first component pin', () => {
    const n = node('s', 'SetText', { target: 't' })
    expect(nodeTarget(defs.get(n.kind), { data: n as never })).toBe('t')
    expect(nodeTarget(defs.get('core/Log@1'), { data: node('l', 'Log') as never })).toBeUndefined()
  })
})

it('lists the entry nodes for the event jump list', () => {
  const g = build([node('e', 'OnWidgetCall', { name: 'Show' }), node('l', 'Log'), node('o', 'OnLoad')])
  expect(eventNodes(defs, g.nodes)).toEqual([{ id: 'e', title: 'On Widget Call', detail: 'Show' }, { id: 'o', title: 'On Load', detail: '' }])
})
