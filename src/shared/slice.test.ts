import { describe, expect, it } from 'vitest'
import { sliceCells, type SliceInsets } from './slice'

const nine: SliceInsets = { l: 24, t: 24, r: 24, b: 24, w: 128, h: 128 }
const hbar: SliceInsets = { l: 8, t: 0, r: 8, b: 0, w: 128, h: 16 }

describe('sliceCells', () => {
  it('9-slice: corners keep their size, edges and centre stretch, the pieces tile the box', () => {
    const c = sliceCells(nine, 200, 140)
    expect(c).toHaveLength(9)
    expect(c.find((k) => k.index === 0)).toMatchObject({ sx: 0, sy: 0, sw: 24, sh: 24, dx: 0, dy: 0, dw: 24, dh: 24 })
    expect(c.find((k) => k.index === 8)).toMatchObject({ dx: 176, dy: 116, dw: 24, dh: 24 })
    expect(c.find((k) => k.index === 4)).toMatchObject({ sx: 24, sy: 24, sw: 80, sh: 80, dx: 24, dy: 24, dw: 152, dh: 92 })
    expect(c.reduce((a, k) => a + k.dw * k.dh, 0)).toBeCloseTo(200 * 140)
  })

  it('horizontal 3-slice: only three pieces, the full height, ends keep 8 px', () => {
    const c = sliceCells(hbar, 240, 16)
    expect(c.map((k) => k.index)).toEqual([3, 4, 5])
    expect(c.map((k) => [k.dx, k.dw])).toEqual([[0, 8], [8, 224], [232, 8]])
    expect(c.every((k) => k.dy === 0 && k.dh === 16)).toBe(true)
  })

  it('a box smaller than the fixed parts shrinks them together and drops the middle: no negative size, no overlap', () => {
    for (const [w, h] of [[40, 40], [48, 48], [10, 200], [0, 0]] as const) {
      const c = sliceCells(nine, w, h)
      for (const k of c) expect(k.dw >= 0 && k.dh >= 0 && k.dx >= -1e-9 && k.dy >= -1e-9 && k.dx + k.dw <= w + 1e-9 && k.dy + k.dh <= h + 1e-9).toBe(true)
    }
    const c = sliceCells(nine, 24, 140)
    expect(c.find((k) => k.index === 1)!.dw).toBe(0)
    expect(c.find((k) => k.index === 0)!.dw).toBe(12)
  })
})
