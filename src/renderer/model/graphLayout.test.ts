import { describe, expect, it } from 'vitest'
import { newEdge, type FlowNode } from '../state/graphStore'
import { tidyPositions } from './graphLayout'

const node = (id: string, x: number, y: number): FlowNode => ({ id, type: 'inkwell', position: { x, y }, measured: { width: 100, height: 50 }, data: { id, kind: 'k', fields: {}, pos: { x, y } } as never })
const wire = (a: string, b: string) => newEdge({ node: a, pin: 'o' }, { node: b, pin: 'i' })

describe('tidyPositions', () => {
  it('is empty for an empty graph', () => expect(tidyPositions([], [])).toEqual({}))

  it('puts a wire target in a column right of its source and stacks siblings', () => {
    const p = tidyPositions([node('a', 500, 300), node('b', 0, 0), node('c', 90, 900)], [wire('a', 'b'), wire('a', 'c')])
    expect(p['a']).toEqual({ x: 0, y: 0 })
    expect(p['b']!.x).toBe(180)
    expect(p['c']!.x).toBe(180)
    expect(Math.abs(p['b']!.y - p['c']!.y)).toBe(90)
  })

  it('survives cycles and self wires', () => {
    const p = tidyPositions([node('a', 0, 0), node('b', 10, 10)], [wire('a', 'b'), wire('b', 'a'), wire('a', 'a')])
    expect(Object.keys(p).sort()).toEqual(['a', 'b'])
  })
})
