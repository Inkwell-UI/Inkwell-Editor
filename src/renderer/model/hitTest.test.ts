import type { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { computeBounds, hitTest } from './hitTest'

const node = (id: string, parent: string | null, children: string[], t: Partial<{ x: number; y: number; width: number; height: number; rotation: number }>, over: Record<string, unknown> = {}) => ({
  id, name: id, type: 'frame', parent, children, visible: true, opacity: 1, anchor: { h: 'left', v: 'top' }, clipContent: false,
  transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, ...t }, ...over
})
const ir = (nodes: ReturnType<typeof node>[]): Swf =>
  ({ specVersion: 3, id: 'r', name: 'r', target: { kind: 'hudWidget' }, stage: { width: 1000, height: 1000 }, root: 'r', nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) }) as unknown as Swf

describe('IR geometry', () => {
  it('accumulates parent offsets', () => {
    const b = computeBounds(ir([node('r', null, ['a'], { width: 1000, height: 1000 }), node('a', 'r', ['b'], { x: 100, y: 50 }), node('b', 'a', [], { x: 10, y: 10, width: 20, height: 5 })]))
    expect(b.get('b')).toEqual({ x: 110, y: 60, width: 20, height: 5 })
  })
  it('a rotated node uses the box around its rotated corners (90 degrees swaps the extent)', () => {
    const b = computeBounds(ir([node('r', null, ['a'], { width: 1000, height: 1000 }), node('a', 'r', [], { x: 200, y: 200, width: 100, height: 20, rotation: 90 })]))
    const a = b.get('a')!
    expect(a.width).toBeCloseTo(20)
    expect(a.height).toBeCloseTo(100)
    expect(a.x).toBeCloseTo(200) // Figma +90 is counterclockwise: the box extends upward from the origin
    expect(a.y).toBeCloseTo(100)
  })
  it('hit test returns the topmost visible node, skips hidden ones, falls back to the root', () => {
    const d = ir([
      node('r', null, ['a', 'b', 'h'], { width: 1000, height: 1000 }),
      node('a', 'r', [], { x: 0, y: 0 }), node('b', 'r', [], { x: 50, y: 50 }), node('h', 'r', [], { x: 50, y: 50 }, { visible: false })
    ])
    expect(hitTest(d, { x: 60, y: 60 })).toBe('b')
    expect(hitTest(d, { x: 10, y: 10 })).toBe('a')
    expect(hitTest(d, { x: 900, y: 900 })).toBe('r')
    expect(hitTest(d, { x: 2000, y: 2000 })).toBeUndefined()
  })
})
