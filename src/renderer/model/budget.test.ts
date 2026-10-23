import type { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { budgetState, countBudget } from './budget'

const n = (id: string, type: string, children: string[], over: Record<string, unknown> = {}) => ({ id, type, children, visible: true, opacity: 1, ...over })
const ir = { root: 'r', nodes: Object.fromEntries([
  n('r', 'frame', ['a', 'b', 'c', 'h']), n('a', 'shape', []), n('b', 'shape', [], { mask: true, opacity: 0.5 }), n('c', 'text', [], { opacity: 0.9 }),
  n('h', 'shape', [], { visible: false }), n('orphan', 'shape', [])
].map((x) => [x.id, x])) } as unknown as Swf

describe('HUD budget', () => {
  it('counts shapes, masks and alpha layers among visible reachable nodes', () => {
    expect(countBudget(ir)).toEqual({ shapes: 2, masks: 1, alphaLayers: 2 })
  })
  it('state thresholds', () => {
    expect(budgetState(10, 150)).toBe('ok')
    expect(budgetState(120, 150)).toBe('near')
    expect(budgetState(151, 150)).toBe('over')
  })
})
