import { describe, expect, it } from 'vitest'
import { Overlay } from '@inkwell-ui/spec'
import { bindingsOf, formatBindings, mockDataOf, parseBindings, setMockKey, withBinding, withMockData } from './graphBinding'
import { overlayProblems, patchNodeOverlay } from './overlay'

describe('bindingsOf', () => {
  it('collects the dataBinding strings of an overlay by node id', () => {
    expect(bindingsOf({ a: { dataBinding: 'text=var:x' }, b: {}, c: { dataBinding: '' }, d: { dataBinding: 5 } })).toEqual({ a: 'text=var:x' })
    expect(bindingsOf(undefined)).toEqual({})
  })
})

describe('data binding string', () => {
  it('round-trips the four properties in a fixed order', () => {
    const s = 'alpha=mock:hp;text=var:score'
    const { bindings, rest } = parseBindings(s)
    expect(bindings).toEqual([{ prop: 'alpha', source: 'mock', name: 'hp' }, { prop: 'text', source: 'var', name: 'score' }])
    expect(rest).toEqual([])
    expect(formatBindings(bindings)).toBe('text=var:score;alpha=mock:hp')
  })
  it('keeps what it does not understand instead of dropping it', () => {
    const { bindings, rest } = parseBindings('text=var:a;color=var:b;junk;visible=mock:x;visible=mock:y')
    expect(bindings.map((b) => b.prop)).toEqual(['text', 'visible'])
    expect(rest).toEqual(['color=var:b', 'junk', 'visible=mock:y'])
    expect(withBinding('text=var:a;junk', 'alpha', { source: 'mock', name: 'hp' })).toBe('text=var:a;alpha=mock:hp;junk')
  })
  it('sets, replaces and removes one property; nothing left means no key', () => {
    let s = withBinding(undefined, 'text', { source: 'var', name: 'score' })
    expect(s).toBe('text=var:score')
    s = withBinding(s, 'text', { source: 'mock', name: 'title' })
    expect(s).toBe('text=mock:title')
    expect(withBinding(s, 'text', null)).toBeUndefined()
    expect(parseBindings(undefined)).toEqual({ bindings: [], rest: [] })
  })
  it('the overlay entry stays valid for the Spec and joins editNode patches', () => {
    const doc = patchNodeOverlay({ specVersion: 5, nodes: {} }, '2:4', { dataBinding: 'text=var:score' })
    expect(Overlay.safeParse(doc).success).toBe(true)
    expect(overlayProblems(doc)).toEqual([])
    expect(patchNodeOverlay(doc, '2:4', { dataBinding: null }).nodes).toEqual({})
  })
})

describe('mock data', () => {
  it('lives under the overlay root, only scalars count, an empty list removes the key', () => {
    const doc = withMockData({ specVersion: 5, nodes: {}, keep: 1 }, { hp: 40, name: 'Aela', dead: false })
    expect(Overlay.safeParse(doc).success).toBe(true)
    expect(mockDataOf(doc)).toEqual({ hp: 40, name: 'Aela', dead: false })
    expect(mockDataOf({ specVersion: 5, nodes: {}, mockData: { a: 1, b: { x: 1 }, c: [] } })).toEqual({ a: 1 })
    expect(withMockData(doc, {})).toEqual({ specVersion: 5, nodes: {}, keep: 1 })
  })
  it('renames a key in place, refusing taken or invalid names', () => {
    const d = { a: 1, b: 2, c: 3 }
    expect(Object.keys(setMockKey(d, 'b', 'bee'))).toEqual(['a', 'bee', 'c'])
    expect(setMockKey(d, 'b', 'c')).toBe(d)
    expect(setMockKey(d, 'b', 'has space')).toBe(d)
    expect(setMockKey(d, 'b', 'b')).toEqual(d)
    expect(setMockKey(d, 'b', undefined)).toEqual({ a: 1, c: 3 })
  })
})
