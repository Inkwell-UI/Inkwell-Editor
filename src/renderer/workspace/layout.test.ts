import { describe, expect, it } from 'vitest'
import { applyOverrides, layoutPanelIds, nodeKey, removePanel, tabsKeyOf, validateLayout, type LayoutNode } from './layout'
import { WORKSPACE_IDS, WORKSPACES } from './workspaces'

const ids = ['a', 'b', 'c']
const p = (panel: string, size?: number): LayoutNode => ({ kind: 'panel', panel, ...(size !== undefined ? { size } : {}) })
const row = (...children: LayoutNode[]): LayoutNode => ({ kind: 'split', direction: 'row', children })
const tabs = (...t: string[]): LayoutNode => ({ kind: 'tabs', tabs: t.map((x) => ({ kind: 'panel', panel: x })) })

describe('validateLayout', () => {
  it('accepts nested splits, tabs and a single panel', () => {
    expect(validateLayout(row(p('a'), { kind: 'split', direction: 'column', children: [p('b', 2), tabs('c')] }), ids)).toEqual([])
    expect(validateLayout(p('a'), ids)).toEqual([])
  })
  it('reports unknown ids and duplicates with their path', () => {
    expect(validateLayout(row(p('a'), p('zzz'), p('a')), ids)).toEqual([
      'layout.children[1]: unknown panel "zzz"',
      'layout.children[2]: panel "a" appears more than once'
    ])
  })
  it('reports empty splits/tabs, bad directions, bad sizes and wrong shapes', () => {
    expect(validateLayout(row(), ids)).toEqual(['layout: a split needs at least one child'])
    expect(validateLayout({ kind: 'split', direction: 'diagonal', children: [p('a')] }, ids)).toEqual(['layout: direction must be "row" or "column"'])
    expect(validateLayout(row(p('a', -1), p('b', Number.NaN)), ids)).toHaveLength(2)
    expect(validateLayout({ kind: 'tabs', tabs: [] }, ids)).toEqual(['layout: tabs needs at least one tab'])
    expect(validateLayout({ kind: 'tabs', tabs: [p('a')], active: 'b' }, ids)).toEqual(['layout: active tab "b" is not one of the tabs'])
    expect(validateLayout({ kind: 'tabs', tabs: [row(p('a'))] }, ids)).toEqual(['layout.tabs[0]: a tab must be a panel'])
    expect(validateLayout({ kind: 'nope' }, ids)).toEqual(['layout: unknown node kind'])
    expect(validateLayout(null, ids)).toEqual(['layout: not an object'])
  })
  it('layouts survive a JSON round trip (plain data)', () => {
    for (const id of WORKSPACE_IDS) expect(JSON.parse(JSON.stringify(WORKSPACES[id].layout))).toEqual(WORKSPACES[id].layout)
  })
})

describe('layout helpers', () => {
  it('lists panels in tree order, tabs included', () => {
    expect(layoutPanelIds(row(p('b'), row(p('a'), tabs('c', 'd'))))).toEqual(['b', 'a', 'c', 'd'])
  })
  it('node keys come from the first panels of the children', () => {
    expect(nodeKey(row(p('a'), row(p('b'), p('c'))))).toBe('a|b')
    expect(nodeKey(tabs('x', 'y'))).toBe('x|y')
  })
  it('removePanel collapses single-child splits and keeps the split size', () => {
    const l = row(p('a'), { kind: 'split', direction: 'column', size: 3, children: [p('b'), p('c')] })
    expect(removePanel(l, 'b')).toEqual(row(p('a'), { ...p('c'), size: 3 }))
    expect(removePanel(l, 'zzz')).toEqual(l)
    expect(removePanel(p('a'), 'a')).toBeUndefined()
    expect(removePanel(tabs('x', 'y'), 'x')).toEqual(p('y'))
  })
  it('applyOverrides sets sizes and tabs when they fit, ignores them when they do not', () => {
    const l = row(p('a'), tabs('b', 'c'))
    const o = applyOverrides(l, { sizes: { 'a|b': [2, 5] }, tabs: { 'b|c': 'c' } }) as Extract<LayoutNode, { kind: 'split' }>
    expect(o.children.map((c) => c.size)).toEqual([2, 5])
    expect((o.children[1] as { active?: string }).active).toBe('c')
    expect(applyOverrides(l, { sizes: { 'a|b': [2] }, tabs: { 'b|c': 'zzz' } })).toEqual(l)
  })
  it('tabsKeyOf finds the group of a panel', () => {
    expect(tabsKeyOf(row(p('a'), tabs('b', 'c')), 'c')).toBe('b|c')
    expect(tabsKeyOf(row(p('a'), tabs('b', 'c')), 'a')).toBeUndefined()
  })
})
