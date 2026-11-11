import { describe, expect, it } from 'vitest'
import { sliceCells, type SliceInsets } from '../../shared/slice'
import { sliceClassName, sliceClassSource } from './sliceAs2'

// The AS2 helper is plain enough to run as JavaScript: pull `axis` and `resize` out of the generated class and check them against shared/slice.ts.
const src = sliceClassSource('M')
const body = (name: string): string => {
  const at = src.indexOf(`static function ${name}(`)
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    if (src[i] === '}' && --depth === 0) return src.slice(src.indexOf('(', at) + 1, src.indexOf(')', at)) + '|' + src.slice(open + 1, i)
  }
  throw new Error(name)
}
const fn = (name: string, scope: Record<string, unknown>) => {
  const [args, code] = body(name).split('|') as [string, string]
  return new Function(...Object.keys(scope), `return function(${args}) {${code.replaceAll(sliceClassName('M'), 'K')}}`)(...Object.values(scope))
}
const K: Record<string, unknown> = {}
K['axis'] = fn('axis', {})
const resize = fn('resize', { K })

const run = (s: SliceInsets, w: number, h: number) => {
  const c: Record<string, any> = { inkwellSlice: { ...s, bw: s.w, bh: s.h } }
  for (let i = 0; i < 9; i++) c[`p${i}`] = {}
  resize(c, w, h)
  return c
}

describe('InkwellSlice AS2 matches shared/slice.ts', () => {
  const cases: [SliceInsets, number, number][] = [
    [{ l: 24, t: 24, r: 24, b: 24, w: 128, h: 128 }, 200, 140],
    [{ l: 24, t: 24, r: 24, b: 24, w: 128, h: 128 }, 40, 40],
    [{ l: 24, t: 24, r: 24, b: 24, w: 128, h: 128 }, 24, 300],
    [{ l: 8, t: 0, r: 8, b: 0, w: 128, h: 16 }, 240, 16],
    [{ l: 0, t: 8, r: 0, b: 8, w: 16, h: 128 }, 16, 240]
  ]
  it.each(cases)('%j at %ix%i', (s, w, h) => {
    const c = run(s, w, h)
    for (const k of sliceCells(s, w, h)) {
      const p = c[`p${k.index}`]
      expect(p._x).toBeCloseTo(k.dx)
      expect(p._y).toBeCloseTo(k.dy)
      expect(p._visible).toBe(k.dw > 0 && k.dh > 0)
      if (k.dw > 0) expect(p._xscale).toBeCloseTo((100 * k.dw) / k.sw)
      if (k.dh > 0) expect(p._yscale).toBeCloseTo((100 * k.dh) / k.sh)
    }
  })

  it('a missing piece (the rows of a 3-slice) is skipped, and w / h undefined keep that side', () => {
    const c: Record<string, any> = { inkwellSlice: { l: 8, t: 0, r: 8, b: 0, w: 128, h: 16, bw: 128, bh: 16 }, p3: {}, p4: {}, p5: {} }
    resize(c, 240, undefined)
    expect(c.inkwellSlice.bh).toBe(16)
    expect(c.p4._xscale).toBeCloseTo((100 * 224) / 112)
  })
})
