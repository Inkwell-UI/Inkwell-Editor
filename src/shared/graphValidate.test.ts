import { resolve } from 'node:path'
import type { Graph } from '@inkwell-ui/spec'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadPacks } from '../main/packs'
import { exportGate } from '../main/lint/gate'
import { defIndex, emptyGraph } from './graphs'
import { graphOrphans, validateGraph, type GraphCode } from './graphValidate'

let defs: ReturnType<typeof defIndex>
beforeAll(async () => void (defs = defIndex(await loadPacks([resolve(__dirname, '../../tests/fixtures/packs/test-pack')]))))

let n = 0
const node = (kind: string, fields: Record<string, unknown> = {}, id = `n${++n}`) => ({ id, kind: `core/${kind}@1`, fields, pos: { x: 0, y: 0 } })
const wire = (a: string, ap: string, b: string, bp: string) => ({ from: { node: a, pin: ap }, to: { node: b, pin: bp } })
const graph = (nodes: Graph['nodes'], edges: Graph['edges'] = [], extra: Partial<Graph> = {}): Graph => ({ ...emptyGraph('g', 'G', 'menu'), nodes, edges, ...extra })
const codes = (g: Graph, ctx: Partial<Parameters<typeof validateGraph>[1]> = {}): GraphCode[] => validateGraph(g, { defs, ...ctx }).map((i) => i.code)

describe('graph validation', () => {
  it('a wired, typed graph is clean', () => {
    const g = graph(
      [node('OnWidgetCall', { name: 'Show', params: [{ name: 'title', type: 'String' }] }, 'e'), node('SetText', { target: 'L1' }, 's'), node('Log', {}, 'l')],
      [wire('e', 'then', 's', 'in'), wire('e', 'title', 's', 'text'), wire('s', 'then', 'l', 'in')]
    )
    expect(validateGraph(g, { defs, layers: new Set(['L1']) })).toEqual([])
  })

  it('type mismatch uses the Spec pinCompat: coercions pass, the rest is an error pinned to the node', () => {
    const base = [node('OnWidgetCall', { name: 'Go', params: [{ name: 'flag', type: 'Bool' }, { name: 'text', type: 'String' }] }, 'e'), node('Add', {}, 'a'), node('SetText', { target: 'L' }, 's')]
    const ok = graph(base, [wire('e', 'then', 's', 'in'), wire('e', 'flag', 'a', 'a'), wire('a', 'value', 's', 'text')]) // Bool->Number, Number->String coerce
    expect(codes(ok)).toEqual([])
    const bad = graph(base, [wire('e', 'then', 's', 'in'), wire('e', 'text', 'a', 'a')]) // String->Number needs To Number
    const [issue] = validateGraph(bad, { defs })
    expect(issue).toMatchObject({ code: 'graph-type-mismatch', nodeId: 'a', pin: 'a', level: 'error', graphId: 'g' })
    expect(codes(graph(base, [wire('e', 'then', 'a', 'a')]))).toContain('graph-type-mismatch') // exec into a data pin
  })

  it('an unconnected required pin is an error; a pin with a default or a target field is not', () => {
    expect(validateGraph(graph([node('SetText', {}, 's')]), { defs }).map((i) => [i.code, i.pin])).toContainEqual(['graph-required-pin', 'target'])
    expect(codes(graph([node('SetText', { target: 'L' }, 's')]))).not.toContain('graph-required-pin')
  })

  it('an exec node no event reaches is a dangling exec warning', () => {
    const [i] = validateGraph(graph([node('Log', {}, 'l')]), { defs })
    expect(i).toMatchObject({ code: 'graph-dangling-exec', level: 'warning', nodeId: 'l' })
    expect(codes(graph([node('Comment')]))).toEqual([]) // editor-only nodes are skipped
  })

  it('a cycle in the exec flow is an error on the node that closes it', () => {
    const g = graph([node('OnClick', { target: 'B' }, 'e'), node('Log', {}, 'a'), node('Log', {}, 'b')], [wire('e', 'then', 'a', 'in'), wire('a', 'then', 'b', 'in'), wire('b', 'then', 'a', 'in')])
    expect(validateGraph(g, { defs }).filter((i) => i.code === 'graph-exec-cycle').map((i) => i.nodeId)).toEqual(['a'])
    const fine = graph([node('OnClick', { target: 'B' }, 'e'), node('Log', {}, 'a'), node('Log', {}, 'b')], [wire('e', 'then', 'a', 'in'), wire('a', 'then', 'b', 'in')])
    expect(codes(fine)).toEqual([])
  })

  it('a target layer missing from the IR is an error carrying the layer id; the node is not dropped', () => {
    const g = graph([node('OnWidgetCall', { name: 'Show' }, 'e'), node('SetText', { target: 'GONE' }, 's')], [wire('e', 'then', 's', 'in')])
    const layers = new Set(['L1'])
    expect(validateGraph(g, { defs, layers }).find((i) => i.code === 'graph-target-missing')).toMatchObject({ nodeId: 's', targetId: 'GONE', pin: 'target' })
    expect(graphOrphans(g, { defs, layers })).toEqual([{ nodeId: 's', pin: 'target', targetId: 'GONE' }])
    expect(codes(g)).not.toContain('graph-target-missing') // layers unknown: skipped
    expect(g.nodes).toHaveLength(2)
  })

  it('an unknown pack node is an error that says its data is preserved, and its wires are not judged', () => {
    const g = graph([node('OnWidgetCall', { name: 'Show' }, 'e'), { id: 'u', kind: 'other/Mystery@2', fields: { q: 1 }, pos: { x: 0, y: 0 } }], [wire('e', 'then', 'u', 'whatever')])
    const issues = validateGraph(g, { defs })
    expect(issues.map((i) => [i.code, i.nodeId])).toEqual([['graph-unknown-node', 'u']])
    expect(issues[0]!.message).toContain('Unknown Pack Node (Data Preserved)')
  })

  it('two handlers of the same event and target are an error, inside a graph and across the SWF', () => {
    const dup = graph([node('OnClick', { target: 'B' }, 'a'), node('OnClick', { target: 'B' }, 'b'), node('OnClick', { target: 'C' }, 'c'), node('OnWidgetCall', { name: 'Show' }, 'w1'), node('OnWidgetCall', { name: 'Hide' }, 'w2')])
    expect(validateGraph(dup, { defs }).filter((i) => i.code === 'graph-duplicate-handler').map((i) => i.nodeId)).toEqual(['b'])
    const other = { ...emptyGraph('c1', 'Button graph', 'component'), nodes: [node('OnClick', { target: 'B' }, 'x')] }
    const mine = graph([node('OnClick', { target: 'B' }, 'y')])
    expect(codes(mine, { siblings: [other, mine] })).toEqual(['graph-duplicate-handler'])
  })

  it('a wire to a missing node or pin is reported', () => {
    expect(codes(graph([node('OnClick', { target: 'B' }, 'e')], [wire('e', 'nope', 'e', 'in')]))).toContain('graph-bad-wire')
    expect(codes(graph([node('OnClick', { target: 'B' }, 'e')], [wire('e', 'then', 'ghost', 'in')]))).toContain('graph-bad-wire')
  })

  it('graph errors block the export gate; the dangling warning blocks only in Strict Mode', () => {
    const item = (code: string, severity: 'error' | 'warning') => ({ severity, code, message: code })
    expect(exportGate([item('graph-type-mismatch', 'error')], false).ok).toBe(false)
    expect(exportGate([item('graph-dangling-exec', 'warning')], false).ok).toBe(true)
    expect(exportGate([item('graph-dangling-exec', 'warning')], true).ok).toBe(false)
  })
})
