import { describe, expect, it } from 'vitest'
import { frame, rectShape, swf } from '../main/swf/ir.testutil'
import { reflowIr, stageForAspect } from './reflow'

const at = (id: string, x: number, width: number, h: 'left' | 'right' | 'center' | 'stretch' | 'scale', extra: Record<string, unknown> = {}) =>
  rectShape(id, { transform: { x, y: 0, width, height: 50, rotation: 0 }, anchor: { h, v: 'top' }, ...extra })

describe('reflowIr', () => {
  const root = (kids: string[]) => frame('r', kids, { transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 } })
  const wide = { width: 2520, height: 1080 }

  it('stageForAspect keeps the height', () => {
    expect(stageForAspect({ width: 1920, height: 1080 }, 21 / 9)).toEqual(wide)
  })

  it('moves and stretches children by their constraint and scales the paths of a stretched shape', () => {
    const ir = swf([root(['l', 'rt', 'c', 's']), at('l', 10, 100, 'left'), at('rt', 1800, 100, 'right'), at('c', 900, 100, 'center'), at('s', 100, 200, 'stretch')])
    const out = reflowIr(ir, wide)
    const x = (id: string) => out.nodes[id]!.transform.x
    expect([x('l'), x('rt'), x('c')]).toEqual([10, 2400, 1200])
    expect(out.nodes['s']!.transform.width).toBe(800)
    expect(out.stage).toEqual(wide)
    const s = out.nodes['s']
    expect(s?.type === 'shape' && (s.paths[0]![1] as { x: number }).x).toBe(800) // 200 * 800/200
    expect(ir.nodes['rt']!.transform.x).toBe(1800) // the input is untouched
  })

  it('shares the extra room of an auto layout among its fill children', () => {
    const row = frame('row', ['a', 'b'], { anchor: { h: 'stretch', v: 'top' }, transform: { x: 0, y: 0, width: 1920, height: 100, rotation: 0 }, autoLayout: { mode: 'horizontal', spacing: 20, padding: [0, 0, 0, 0], primaryAlign: 'start', counterAlign: 'start', wrap: false } })
    const a = at('a', 0, 400, 'left')
    const b = at('b', 420, 1500, 'left', { layout: { h: 'fill', v: 'fixed' } })
    const out = reflowIr(swf([root(['row']), row, a, b]), wide)
    expect(out.nodes['b']!.transform).toMatchObject({ x: 420, width: 2100 })
  })

  it('is the identity at the design size', () => {
    const ir = swf([root([])])
    expect(reflowIr(ir, ir.stage)).toBe(ir)
  })
})
