import { describe, expect, it } from 'vitest'
import { imageHashes } from '@inkwell-ui/spec'
import { buildImageSheet, IMAGES, MOD_ID, SHEETS } from '../../../scripts/image-test-sheet'
import { generate } from './generate'
import { parseSwf, readPlace } from './swfReader.testutil'
import { TAG, writeSwf } from './tags'

const images = (h: string) => Object.values(IMAGES).find((i) => i.hash === h)?.image

describe('in-game image test sheet', () => {
  const built = SHEETS.map((s) => generate(buildImageSheet(s.id, s.mode), { modId: MOD_ID, imageMode: s.mode, images }))
  const names = (g: (typeof built)[number]) => parseSwf(writeSwf({ widthPx: 1280, heightPx: 720, tags: g.tags })).tags.filter((t) => t.code === TAG.PlaceObject2).map(readPlace).map((p) => p.name)

  it('both modes compile without lint warnings or errors (all images are powers of two)', () => {
    for (const g of built) expect(g.lint.filter((l) => l.severity !== 'info')).toEqual([])
  })

  it('the two menus show the same items (same instance names); only the dds one loads DDS files, one per item', () => {
    expect(names(built[0]!)).toEqual(names(built[1]!))
    expect(built.map((g) => g.ddsImages)).toEqual([0, 8])
    const used = new Set(Object.values(buildImageSheet('x', 'dds').nodes).flatMap(imageHashes))
    expect([...used].sort()).toEqual(Object.values(IMAGES).map((i) => i.hash).sort())
  })
})
