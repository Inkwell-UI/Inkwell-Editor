import { describe, expect, it } from 'vitest'
import { deliverMock } from './mockDelivery'

describe('deliverMock', () => {
  it('resets, sets each key with its typed value, then signals done', () => {
    const calls: unknown[][] = []
    expect(deliverMock({ call: (fn, ...a) => (calls.push([fn, ...a]), true) }, { hp: 40, name: 'Aela', on: true })).toBe(true)
    expect(calls).toEqual([['inkwellMockReset'], ['inkwellMock', 'hp', 40], ['inkwellMock', 'name', 'Aela'], ['inkwellMock', 'on', true], ['inkwellMockDone']])
  })
  it('reports a movie without the bridge', () => {
    expect(deliverMock({ call: () => false }, { a: 1 })).toBe(false)
  })
})
