import { describe, expect, it } from 'vitest'
import { satisfies } from './semverRange'

describe('satisfies (pack compatible.tool)', () => {
  it('caret: the leftmost non-zero part may not change', () => {
    expect(satisfies('0.5.0', '^0.5.0')).toBe(true)
    expect(satisfies('0.5.9', '^0.5.0')).toBe(true)
    expect(satisfies('0.6.0', '^0.5.0')).toBe(false)
    expect(satisfies('0.4.9', '^0.5.0')).toBe(false)
    expect(satisfies('1.4.0', '^1.2.0')).toBe(true)
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false)
    expect(satisfies('0.0.3', '^0.0.3')).toBe(true)
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false)
  })
  it('tilde, comparators, several terms and a bare version', () => {
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true)
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false)
    expect(satisfies('0.5.0', '>=0.2.0')).toBe(true)
    expect(satisfies('0.5.0', '>=0.2.0 <0.5.0')).toBe(false)
    expect(satisfies('0.5.0', '0.5.0')).toBe(true)
    expect(satisfies('0.5.1', '=0.5.0')).toBe(false)
  })
  it('an unparseable range or version is not satisfied', () => {
    expect(satisfies('0.5.0', '')).toBe(false)
    expect(satisfies('0.5.0', '*')).toBe(false)
    expect(satisfies('0.5.0', '^0.5 || ^1')).toBe(false)
    expect(satisfies('nope', '^0.5.0')).toBe(false)
  })
})
