import { describe, expect, it } from 'vitest'
import { newEdge, type FlowNode } from '../state/graphStore'
import { tidyPositions } from './graphLayout'

const node = (id: string, x: number, y: number): FlowNode => ({ id, type: 'inkwell', position: { x, y }, measured: { width: 100, height: 50 }, data: { id, kind: 'k', fields: {}, pos: { x, y } } as never })
const wire = (a: string, b: string) => newEdge({ node: a, pin: 'o' }, { node: b, pin: 'i' })

describe('tidyPositions', () => {
  it('is empty for an empty graph', () => expect(tidyPositions([], [])).toEqual({}))

  it('puts a wire target in a column right of its source, stacks siblings and centres the source between them', () => {
    const p = tidyPositions([node('a', 500, 300), node('b', 0, 0), node('c', 90, 900)], [wire('a', 'b'), wire('a', 'c')])
    expect(p['b']).toEqual({ x: 180, y: 0 })
    expect(p['c']).toEqual({ x: 180, y: 90 })
    expect(p['a']).toEqual({ x: 0, y: 45 })
  })

  it('keeps a chain on one line and puts an input-less data node right before its consumer, not in the first column', () => {
    const exec = (a: string, b: string) => ({ ...wire(a, b), id: `x-${a}-${b}` })
    const nodes = [node('e', 0, 0), node('s1', 300, 300), node('s2', 600, 600), node('get', 0, 700)]
    const p = tidyPositions(nodes, [exec('e', 's1'), exec('s1', 's2'), wire('get', 's2')], (e) => e.id.startsWith('x-'))
    expect(['e', 's1', 's2'].map((id) => p[id]!.y)).toEqual([p['e']!.y, p['e']!.y, p['e']!.y]) // straight
    expect(p['s2']!.x).toBe(360)
    expect(p['get']!.x).toBe(180) // one column left of s2, not the first column
  })

  it('lays unconnected parts out one below the other and wireless nodes last in one column', () => {
    const p = tidyPositions([node('a', 0, 0), node('b', 0, 10), node('c', 400, 400), node('d', 900, 20), node('lone', 50, 5)], [wire('a', 'b'), wire('c', 'd')])
    expect(p['a']!.y).toBe(p['b']!.y)
    expect(p['c']!.y).toBeGreaterThan(p['a']!.y + 50)
    expect(p['c']!.x).toBe(p['a']!.x)
    expect(p['lone']!.x).toBe(p['a']!.x)
    expect(p['lone']!.y).toBeGreaterThan(p['c']!.y + 50)
  })

  it('survives cycles and self wires', () => {
    const p = tidyPositions([node('a', 0, 0), node('b', 10, 10)], [wire('a', 'b'), wire('b', 'a'), wire('a', 'a')])
    expect(Object.keys(p).sort()).toEqual(['a', 'b'])
  })
})
