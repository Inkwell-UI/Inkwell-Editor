import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { Node } from '@inkwell-ui/spec'
import type { Rgba } from '../images/png'
import { syntheticPng } from '../images/synthetic'
import { fitImage, generate, type GenerateOptions } from './generate'
import { frame, rectShape, swf, textNode } from './ir.testutil'
import { parseSwf, parseTags, readPlace, type RawTag } from './swfReader.testutil'
import { TAG, writeSwf } from './tags'

const A = syntheticPng(64, 64)
const B = syntheticPng(256, 128)
const assets: Record<string, Rgba> = { [A.hash]: A.image, [B.hash]: B.image }
const images = (h: string): Rgba | undefined => assets[h]

const image = (id: string, asset: string, over: Record<string, unknown> = {}): Node =>
  ({ ...rectShape(id), name: `img ${id}`, type: 'image', asset, scaleMode: 'fill', ...over }) as unknown as Node
const gen = (nodes: Node[], o: Partial<GenerateOptions> = {}) => generate(swf(nodes, { id: 'imgs' }), { modId: 'MyMod', images, ...o })
const tagsOf = (g: ReturnType<typeof gen>) => parseSwf(writeSwf({ widthPx: 1920, heightPx: 1080, tags: g.tags })).tags
const codes = (l: ReturnType<typeof gen>['lint']) => l.map((i) => [i.severity, i.code, i.nodeId])

/** DefineBitsLossless2 -> id, size and the inflated ARGB. */
const readBits = (t: RawTag) => ({ id: t.body.readUInt16LE(0), format: t.body[2], w: t.body.readUInt16LE(3), h: t.body.readUInt16LE(5), argb: inflateSync(t.body.subarray(7)) })
/** The fill style of a one-fill DefineShape3 with a bitmap fill: type, bitmap id, matrix scale and translate (twips). */
function readBitmapFill(t: RawTag) {
  const b = t.body
  let pos = 2
  let bit = 0
  const ub = (n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++) {
      v = v * 2 + ((b[pos]! >> (7 - bit)) & 1)
      if (++bit === 8) (bit = 0), pos++
    }
    return v
  }
  const sb = (n: number): number => { const v = ub(n); return v >= 2 ** (n - 1) ? v - 2 ** n : v }
  const align = () => { if (bit) (bit = 0), pos++ }
  const nb = ub(5)
  const bounds = { x0: sb(nb), x1: sb(nb), y0: sb(nb), y1: sb(nb) }
  align()
  const count = b[pos++]!
  const type = b[pos++]!
  const bitmapId = b.readUInt16LE(pos)
  pos += 2
  let scale = 1
  if (ub(1)) { const n = ub(5); scale = sb(n) / 65536; sb(n) }
  if (ub(1)) { const n = ub(5); sb(n); sb(n) }
  const nt = ub(5)
  const tx = sb(nt), ty = sb(nt)
  return { bounds, count, type, bitmapId, scale, tx, ty }
}
const sprites = (tags: RawTag[]) => tags.filter((t) => t.code === TAG.DefineSprite).map((t) => ({ id: t.body.readUInt16LE(0), tags: parseTags(t.body.subarray(4)) }))

describe('fitImage', () => {
  it('fill covers the box (cropped, centred); fit shows all of it (letterboxed, centred); tile is 1:1', () => {
    expect(fitImage('fill', 100, 50, 100, 100)).toEqual({ rect: { x: 0, y: 0, w: 100, h: 100 }, scale: 2, tx: -50, ty: 0 })
    expect(fitImage('fit', 100, 50, 100, 100)).toEqual({ rect: { x: 0, y: 25, w: 100, h: 50 }, scale: 1, tx: 0, ty: 25 })
    expect(fitImage('tile', 100, 50, 300, 300)).toMatchObject({ rect: { x: 0, y: 0, w: 300, h: 300 }, scale: 1, repeat: true })
  })
})

describe('images, embedded mode (default)', () => {
  it('an image node becomes a named clip holding a bitmap-filled shape; the bitmap is premultiplied ARGB and shared by hash', () => {
    const g = gen([frame('f', ['i', 'j']), image('i', A.hash, { scaleMode: 'fit' }), image('j', A.hash, { name: 'logo' })])
    expect(g.lint).toEqual([])
    const t = tagsOf(g)
    const bits = t.filter((x) => x.code === TAG.DefineBitsLossless2).map(readBits)
    expect(bits).toHaveLength(1)
    expect(bits[0]).toMatchObject({ format: 5, w: 64, h: 64 })
    // pixel 0 is the opaque yellow border; pixel (1, 32) is half transparent blue: premultiplied
    expect([...bits[0]!.argb.subarray(0, 4)]).toEqual([255, 255, 220, 0])
    const src = A.image.rgba, i = (32 * 64 + 1) * 4, a = src[i + 3]!
    expect([...bits[0]!.argb.subarray(i, i + 4)]).toEqual([a, Math.round((src[i]! * a) / 255), Math.round((src[i + 1]! * a) / 255), Math.round((src[i + 2]! * a) / 255)])
    const fills = t.filter((x) => x.code === TAG.DefineShape3).map(readBitmapFill)
    expect(fills).toHaveLength(2)
    expect(fills.every((f) => f.bitmapId === bits[0]!.id && f.type === 0x41 && f.count === 1)).toBe(true)
    // the image box is 200x50: fit -> 50 px high, centred; fill -> 200 px wide, cropped
    expect(fills[0]).toMatchObject({ scale: (50 / 64) * 20, tx: 75 * 20, ty: 0, bounds: { x0: 1500, x1: 2500, y0: 0, y1: 1000 } })
    expect(fills[1]).toMatchObject({ scale: (200 / 64) * 20, tx: 0, ty: -75 * 20, bounds: { x0: 0, x1: 4000, y0: 0, y1: 1000 } })
    const places = t.filter((x) => x.code === TAG.PlaceObject2).map(readPlace)
    expect(places.map((p) => p.name)).toEqual(['img_i', 'logo'])
    expect(places[0]!.matrix).toMatchObject({ x: 200, y: 400 })
  })

  it('node opacity times the paint opacity is the clip alpha; rotation still applies', () => {
    const g = gen([frame('f', ['i']), image('i', A.hash, { opacity: 0.5, fillOpacity: 0.5, transform: { x: 0, y: 0, width: 64, height: 64, rotation: 90 } })])
    const p = tagsOf(g).filter((x) => x.code === TAG.PlaceObject2).map(readPlace)[0]!
    expect(p.alphaMult).toBeCloseTo(0.25, 2)
    expect(p.matrix?.skew).toEqual([-1, 1]) // -90 deg in Flash: sin = -1
  })

  it('TILE repeats at 1:1 with a warning; CROP is drawn as FILL with a warning', () => {
    const g = gen([frame('f', ['i', 'j']), image('i', A.hash, { scaleMode: 'tile' }), image('j', A.hash, { scaleMode: 'crop' })])
    expect(codes(g.lint)).toEqual([['warning', 'image-scale-mode', 'i'], ['warning', 'image-scale-mode', 'j']])
    const fills = tagsOf(g).filter((x) => x.code === TAG.DefineShape3).map(readBitmapFill)
    expect(fills.map((f) => [f.type, f.scale])).toEqual([[0x40, 20], [0x41, (200 / 64) * 20]])
  })

  it('a frame image fill is a background clip under the children, sized to the frame', () => {
    const f = frame('g', ['t'], { fills: [{ type: 'solid', color: { r: 1, g: 0, b: 0 } }, { type: 'image', asset: B.hash, scaleMode: 'fit', opacity: 0.5 }] })
    const g = gen([frame('f', ['g']), f, textNode('t')])
    expect(codes(g.lint)).toEqual([['info', 'frame-fill-unsupported', 'g']])
    const inner = sprites(tagsOf(g)).find((s) => s.tags.filter((x) => x.code === TAG.PlaceObject2).length === 2)!
    const p = inner.tags.filter((x) => x.code === TAG.PlaceObject2).map(readPlace)
    expect(p.map((x) => [x.depth, x.name])).toEqual([[1, 'imageFill'], [2, 'text_t']])
    expect(p[0]!.alphaMult).toBeCloseTo(0.5, 2)
  })

  it('the root frame can carry an image fill too', () => {
    const g = gen([frame('f', [], { fills: [{ type: 'image', asset: A.hash }] })])
    expect(tagsOf(g).filter((x) => x.code === TAG.PlaceObject2).map(readPlace).map((p) => p.name)).toEqual(['imageFill'])
  })

  it('lint: missing asset (error, not drawn), too large (error), power of two is not a concern when embedded', () => {
    const big: Rgba = { width: 2049, height: 4, rgba: Buffer.alloc(2049 * 4 * 4) }
    const g = generate(swf([frame('f', ['i', 'j', 'k']), image('i', 'f'.repeat(40)), image('j', 'e'.repeat(40)), image('k', B.hash)], { id: 'x' }), {
      modId: 'M', images: (h) => (h === 'e'.repeat(40) ? big : images(h))
    })
    expect(codes(g.lint)).toEqual([['error', 'image-missing-asset', 'i'], ['error', 'image-too-large', 'j']])
    expect(tagsOf(g).filter((x) => x.code === TAG.DefineBitsLossless2)).toHaveLength(2)
  })

  it('an image fill on a non-rectangle shape is still skipped with a warning', () => {
    const g = gen([frame('f', ['s']), rectShape('s', { fills: [{ type: 'image', asset: A.hash }], strokes: [{ fill: { type: 'solid', color: { r: 0, g: 0, b: 0 } }, weight: 1, alignment: 'center' }] })])
    expect(g.lint.map((l) => l.code)).toContain('fill-unsupported')
  })
})

describe('images, dds mode', () => {
  const nodes = () => [frame('f', ['i', 'j']), image('i', A.hash, { scaleMode: 'fit', name: 'Logo' }), image('j', B.hash)]

  it('places an empty named clip and loads img://textures/Inkwell/<mod>/<hash>.dds into it from an AS2 class', () => {
    const g = gen(nodes(), { imageMode: 'dds' })
    const t = tagsOf(g)
    expect(t.some((x) => x.code === TAG.DefineBitsLossless2)).toBe(false)
    expect(g.ddsImages).toBe(2)
    expect(codes(g.lint)).toEqual([]) // 64x64 and 256x128 are powers of two
    const cls = g.as2.find((f) => f.path === '__Packages/mods/MyMod/ImgsImages.as')!.source
    expect(cls).toContain(`mods.MyMod.ImgsImages.load(root.Logo, "img://textures/Inkwell/MyMod/${A.hash}.dds", 200, 50, 64, 64, "fit", "i");`)
    expect(cls).toContain(`load(root.img_j, "img://textures/Inkwell/MyMod/${B.hash}.dds", 200, 50, 256, 128, "fill", "j")`)
    expect(cls).toContain('new MovieClipLoader()')
    expect(cls).toContain('onLoadInit')
    expect(cls).toContain('setMask')
    expect(cls).not.toMatch(/\bError\b|flash\.filters/) // Flash 8 level, no Error class in GFx
    expect(cls.match(/try \{/g)!.length).toBe(3) // one per node + the load callback
    expect(g.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source).toContain('mods.MyMod.ImgsImages.apply(this);')
    const places = t.filter((x) => x.code === TAG.PlaceObject2).map(readPlace)
    expect(places.map((p) => p.name)).toEqual(['Logo', 'img_j'])
    expect(sprites(t).filter((s) => places.some((p) => p.charId === s.id)).every((s) => s.tags.length === 2)).toBe(true) // ShowFrame + End only
  })

  it('warns about non-power-of-two images only in dds mode; TILE becomes FILL', () => {
    const odd = syntheticPng(30, 20)
    const ir = swf([frame('f', ['i']), image('i', odd.hash, { scaleMode: 'tile' })], { id: 'x' })
    const look = (h: string) => (h === odd.hash ? odd.image : undefined)
    expect(codes(generate(ir, { modId: 'M', images: look, imageMode: 'dds' }).lint)).toEqual([['warning', 'image-scale-mode', 'i'], ['warning', 'image-not-power-of-two', 'i']])
    expect(codes(generate(ir, { modId: 'M', images: look }).lint)).toEqual([['warning', 'image-scale-mode', 'i']])
    expect(generate(ir, { modId: 'M', images: look, imageMode: 'dds' }).as2[0]!.source).toContain('"fill"')
  })

  it('the preview always embeds the bitmap (Ruffle cannot load img://)', () => {
    const g = gen(nodes(), { imageMode: 'dds', preview: true })
    expect(g.ddsImages).toBe(0)
    expect(tagsOf(g).filter((x) => x.code === TAG.DefineBitsLossless2)).toHaveLength(2)
    expect(g.as2.some((f) => f.path.endsWith('Images.as'))).toBe(false)
  })

  it('widget output: image paths start at the widget clip', () => {
    const ir = swf([frame('root', ['w']), frame('w', ['i']), image('i', A.hash)], { id: 'hud' })
    const g = generate(ir, { modId: 'M', images, imageMode: 'dds', widget: true })
    expect(g.as2.find((f) => f.path.endsWith('HudImages.as'))!.source).toContain('load(root.widget.img_i,')
  })
})
