import type { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { buildLayerTree, filterTree, flattenTree, lintCounts, withRuntimeRows } from './layerTree'

const base = { anchor: { h: 'left', v: 'top' }, visible: true, opacity: 1 }
const t = (x = 0) => ({ x, y: 0, width: 10, height: 10, rotation: 0 })
const ir = {
  specVersion: 3, id: 'r', name: 'r', target: { kind: 'hudWidget' }, stage: { width: 100, height: 100 }, root: 'r',
  nodes: {
    r: { ...base, id: 'r', name: 'Root', type: 'frame', parent: null, children: ['a', 'b', 'gone', 'a'], transform: t(), clipContent: false },
    a: { ...base, id: 'a', name: 'Title_Txt', type: 'text', parent: 'r', children: [], transform: t(), content: '$KEY', runs: [], sizing: 'fixed' },
    b: { ...base, id: 'b', name: 'Panel', type: 'frame', parent: 'r', children: ['c'], transform: t(), clipContent: false },
    c: { ...base, id: 'c', name: 'Value_Txt', type: 'text', parent: 'b', children: [], transform: t(), content: 'Hello', runs: [], sizing: 'fixed' }
  }
} as unknown as Swf

describe('layer tree', () => {
  const lint = [
    { nodeId: 'c', severity: 'warning' as const }, { nodeId: 'c', severity: 'error' as const }, { nodeId: 'a', severity: 'info' as const }
  ]
  const tree = buildLayerTree(ir, { specVersion: 3, nodes: { b: { scripts: ['g1'], role: 'list' }, c: { dataBinding: 'x', focus: { order: 1 } } } }, lint)!

  it('walks the IR in order, skips missing and repeated children', () => {
    expect(tree.children.map((c) => c.id)).toEqual(['a', 'b'])
    expect(tree.children[1]!.children.map((c) => c.id)).toEqual(['c'])
  })
  it('badges: lint counts (not info), $ only for text starting with $, overlay script/link/pad', () => {
    const [a, b] = tree.children
    expect(a!.badges).toEqual([{ kind: 'placeholder' }])
    expect(b!.badges).toEqual([{ kind: 'script' }])
    expect(b!.children[0]!.badges).toEqual([{ kind: 'error', count: 1 }, { kind: 'warning', count: 1 }, { kind: 'link' }, { kind: 'pad' }])
    expect(lintCounts(lint).get('a')).toBeUndefined()
  })
  it('filters by name, role or type and keeps ancestors', () => {
    expect(filterTree(tree, 'value')!.children.map((c) => c.id)).toEqual(['b'])
    expect(filterTree(tree, 'LIST')!.children.map((c) => c.id)).toEqual(['b']) // role
    expect(filterTree(tree, 'zzz')).toBeUndefined()
    expect(filterTree(tree, '  ')).toBe(tree)
  })
  it('flattens with depth; collapsed hides children unless filtering', () => {
    expect(flattenTree(tree, new Set()).map((r) => [r.id, r.depth])).toEqual([['r', 0], ['a', 1], ['b', 1], ['c', 2]])
    expect(flattenTree(tree, new Set(['b'])).map((r) => r.id)).toEqual(['r', 'a', 'b'])
    expect(flattenTree(tree, new Set(['b']), true).map((r) => r.id)).toEqual(['r', 'a', 'b', 'c'])
  })
})

describe('withRuntimeRows', () => {
  const row = (id: string, depth: number, over: object = {}) => ({ id, name: id, type: 'frame', badges: [], depth, hasChildren: false, expanded: true, ...over }) as never
  const rows = [row('root', 0, { hasChildren: true }), row('p', 1, { hasChildren: true }), row('kid', 2), row('other', 1)]
  it('puts the instances a graph made under their parent, after its own children, marked as runtime', () => {
    const out = withRuntimeRows(rows, [{ parent: 'p', component: 'c1', path: '_level0.a.i0' }, { parent: 'p', component: 'c1', path: '_level0.a.i1' }], () => 'ListItem')
    expect(out.map((r) => r.id)).toEqual(['root', 'p', 'kid', 'runtime:_level0.a.i0', 'runtime:_level0.a.i1', 'other'])
    expect(out[3]).toMatchObject({ name: 'ListItem', runtime: true, depth: 2 })
    expect(withRuntimeRows([row('lone', 1)], [{ parent: 'lone', component: 'c1', path: 'x' }], () => 'n')[0]).toMatchObject({ hasChildren: true }) // a layer with only runtime children is expandable too
  })
  it('a filter keeps the instances whose name (or the Runtime tag) matches, and none otherwise', () => {
    const spawned = [{ parent: 'p', component: 'c1', path: 'x' }]
    expect(withRuntimeRows(rows, spawned, () => 'ListItem', 'list').map((r) => r.id)).toContain('runtime:x')
    expect(withRuntimeRows(rows, spawned, () => 'ListItem', 'runt').map((r) => r.id)).toContain('runtime:x')
    expect(withRuntimeRows(rows, spawned, () => 'ListItem', 'zzz').map((r) => r.id)).not.toContain('runtime:x')
  })
  it('a collapsed parent, or one that is not listed, shows none', () => {
    const collapsed = [row('p', 1, { hasChildren: true, expanded: false })]
    expect(withRuntimeRows(collapsed, [{ parent: 'p', component: 'c1', path: 'x' }], () => 'n')).toHaveLength(1) // still one row: the twisty stays so it can be opened
    expect(withRuntimeRows(rows, [{ parent: 'elsewhere', component: 'c1', path: 'x' }], () => 'n')).toHaveLength(rows.length)
  })
})
