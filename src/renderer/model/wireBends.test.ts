import { describe, expect, it } from 'vitest'
import { bendIndex, readBends } from './wireBends'

describe('wire bends', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 400, y: 0 }
  it('a new bend goes after the bends that come before it along the wire', () => {
    expect(bendIndex(a, [], b, { x: 200, y: 5 })).toBe(0)
    const mid = { x: 200, y: 100 }
    expect(bendIndex(a, [mid], b, { x: 50, y: 20 })).toBe(0)
    expect(bendIndex(a, [mid], b, { x: 350, y: 20 })).toBe(1)
  })
  it('reads only well-formed points', () => {
    expect(readBends({ bends: [{ x: 1, y: 2 }, 'x', { x: 1 }] })).toEqual([{ x: 1, y: 2 }])
    expect(readBends(undefined)).toEqual([])
  })
})
