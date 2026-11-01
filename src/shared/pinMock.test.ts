import { describe, expect, it } from 'vitest'
import { isMockPinType, mockRead, pinMocksOf, withPinMock } from './pinMock'

describe('pinMock', () => {
  it('reads only string links', () => {
    expect(pinMocksOf({ pinMock: { find: 'term', bad: 3, empty: '' } })).toEqual({ find: 'term' })
    expect(pinMocksOf(undefined)).toEqual({})
    expect(pinMocksOf({ pinMock: ['x'] })).toEqual({})
  })

  it('sets and removes a link and keeps the rest of extra', () => {
    const a = withPinMock({ note: 1 }, 'find', 'term')
    expect(a).toEqual({ note: 1, pinMock: { find: 'term' } })
    const b = withPinMock(a, 'b', 'two')
    expect(b).toEqual({ note: 1, pinMock: { find: 'term', b: 'two' } })
    expect(withPinMock(b, 'find', undefined)).toEqual({ note: 1, pinMock: { b: 'two' } })
    expect(withPinMock({ pinMock: { find: 'term' } }, 'find', undefined)).toBeUndefined()
  })

  it('only String, Number and Bool inputs can be bound', () => {
    expect(['String', 'Number', 'Bool'].every(isMockPinType)).toBe(true)
    expect(['Exec', 'Array', 'Object', 'Text'].some(isMockPinType)).toBe(false)
  })

  it('coerces by pin type', () => {
    expect(mockRead('Number', 'm')).toBe('Number(m)')
    expect(mockRead('Bool', 'm')).toBe('(m == true || m == "true")')
  })
})
