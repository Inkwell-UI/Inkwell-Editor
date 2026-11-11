import { describe, expect, it } from 'vitest'
import { buildSliceSheet, casesFor, extendSliceSheet, IMGS, MOD_ID, SHEETS } from '../../../scripts/slice-test-sheet'
import { syntheticSlice } from '../images/synthetic'
import { generate } from './generate'
import { parseSwf } from './swfReader.testutil'
import { TAG, writeSwf } from './tags'

describe('in-game slice test sheet', () => {
  const built = SHEETS.map((s) => {
    const g = generate(buildSliceSheet(s.id, s.mode), { modId: MOD_ID, imageMode: s.mode })
    return { s, g, x: extendSliceSheet(s.mode, (h) => `img://textures/Inkwell/${MOD_ID}/${h}.dds`)(g) }
  })
  const codes = (b: (typeof built)[number]) => parseSwf(writeSwf({ widthPx: 1280, heightPx: 720, tags: b.x.tags })).tags.map((t) => t.code)

  it('compiles without lint warnings or errors', () => {
    for (const b of built) expect(b.g.lint.filter((l) => l.severity !== 'info')).toEqual([])
  })

  it('embedded carries one scaling grid per image and the tag-only cases; dds none, and no tag-only case', () => {
    const [emb, dds] = built
    expect(codes(emb!).filter((c) => c === TAG.DefineScalingGrid)).toHaveLength(Object.keys(IMGS).length)
    expect(codes(dds!)).not.toContain(TAG.DefineScalingGrid)
    expect(casesFor('dds').some((k) => k.method === 'T' || k.method === 'T2')).toBe(false)
    expect(dds!.x.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source).toContain('img://textures/Inkwell/SliceTest/')
  })

  it('the 3-slice images only have two insets and every image has a distinct hash', () => {
    expect(new Set(Object.values(IMGS).map((i) => i.s.hash)).size).toBe(3)
    const bar = syntheticSlice(128, 16, { l: 8, t: 0, r: 8, b: 0 }, 4).image
    expect(bar.rgba[3]).toBe(255) // border pixel is opaque; the round cutouts only exist in 9-slice corners
    expect(IMGS.hbar.g).toEqual({ x: 8, y: 0, w: 112, h: 16 })
  })
})
