import { describe, expect, it } from 'vitest'
import { defaultLayout, layoutPanelIds, validateLayout, type LayoutNode } from './layout'

const ids = ['a', 'b', 'c']
const p = (panel: string, size?: number): LayoutNode => ({ kind: 'panel', panel, ...(size !== undefined ? { size } : {}) })
const row = (...children: LayoutNode[]): LayoutNode => ({ kind: 'split', direction: 'row', children })

describe('validateLayout', () => {
  it('accepts nested splits and a single panel', () => {
    expect(validateLayout(row(p('a'), { kind: 'split', direction: 'column', children: [p('b', 2), p('c')] }), ids)).toEqual([])
    expect(validateLayout(p('a'), ids)).toEqual([])
  })
  it('reports unknown ids and duplicates with their path', () => {
    expect(validateLayout(row(p('a'), p('zzz'), p('a')), ids)).toEqual([
      'layout.children[1]: unknown panel "zzz"',
      'layout.children[2]: panel "a" appears more than once'
    ])
  })
  it('reports empty splits, bad directions, bad sizes and wrong shapes', () => {
    expect(validateLayout(row(), ids)).toEqual(['layout: a split needs at least one child'])
    expect(validateLayout({ kind: 'split', direction: 'diagonal', children: [p('a')] }, ids)).toEqual(['layout: direction must be "row" or "column"'])
    expect(validateLayout(row(p('a', -1), p('b', Number.NaN)), ids)).toHaveLength(2)
    expect(validateLayout({ kind: 'tabs' }, ids)).toEqual(['layout: unknown node kind'])
    expect(validateLayout(null, ids)).toEqual(['layout: not an object'])
  })
  it('the layout survives a JSON round trip (it is plain data)', () => {
    expect(JSON.parse(JSON.stringify(defaultLayout))).toEqual(defaultLayout)
  })
})

describe('layoutPanelIds', () => {
  it('lists panels in tree order', () => {
    expect(layoutPanelIds(row(p('b'), row(p('a'), p('c'))))).toEqual(['b', 'a', 'c'])
  })
})
