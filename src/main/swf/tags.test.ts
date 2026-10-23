import { describe, expect, it } from 'vitest'
import { parseSwf, readEditText, readImportAssets2, readPlace } from './swfReader.testutil'
import * as T from './tags'

describe('tag writer', () => {
  it('writes a header the reader parses back, with correct length', () => {
    const buf = T.writeSwf({ widthPx: 1920, heightPx: 1080, tags: [T.setBackgroundColor(1, 2, 3), T.showFrame(), T.endTag()] })
    const s = parseSwf(buf)
    expect(s).toMatchObject({ signature: 'FWS', version: 10, length: buf.length, frames: 1, frameRate: 30 })
    expect(s.frameSize).toEqual({ x0: 0, x1: 38400, y0: 0, y1: 21600 })
    expect(s.tags.map((t) => t.code)).toEqual([T.TAG.SetBackgroundColor, T.TAG.ShowFrame, T.TAG.End])
    expect([...s.tags[0]!.body]).toEqual([1, 2, 3])
  })

  it('uses the long tag form for bodies of 63 bytes or more', () => {
    const buf = T.writeSwf({ widthPx: 10, heightPx: 10, tags: [T.tag(T.TAG.DoAction, Buffer.alloc(100, 7)), T.endTag()] })
    const t = parseSwf(buf).tags[0]!
    expect(t.body.length).toBe(100)
    expect(t.body.every((b) => b === 7)).toBe(true)
  })

  it('DefineEditText is variant A: fontId + outlines, never fontClass or static', () => {
    const body = T.defineEditText({
      id: 3, wPx: 124, hPx: 34, fontId: 2, sizePx: 18, color: { r: 255, g: 128, b: 0, a: 255 }, text: 'Hi\rthere',
      wordWrap: true, multiline: true, autoSize: false, align: 2, leadingPx: -1.5
    })
    const e = readEditText(parseSwf(T.writeSwf({ widthPx: 1, heightPx: 1, tags: [body, T.endTag()] })).tags[0]!)
    expect(e).toMatchObject({
      id: 3, fontId: 2, hasFont: true, hasFontClass: false, useOutlines: true, readOnly: true, wasStatic: false, html: false,
      wordWrap: true, multiline: true, autoSize: false, fontHeight: 360, color: { r: 255, g: 128, b: 0, a: 255 },
      layout: { align: 2, leading: -30 }, text: 'Hi\rthere', bounds: { x1: 2480, y1: 680 }
    })
  })

  it('ImportAssets2 imports one alias from gfxfontlib.swf into a local id', () => {
    const t = parseSwf(T.writeSwf({ widthPx: 1, heightPx: 1, tags: [T.importAssets2('gfxfontlib.swf', { id: 2, name: '$EverywhereMediumFont' }), T.endTag()] })).tags[0]!
    expect(t.code).toBe(T.TAG.ImportAssets2)
    expect(readImportAssets2(t)).toEqual({ url: 'gfxfontlib.swf', items: [{ id: 2, name: '$EverywhereMediumFont' }] })
  })

  it('PlaceObject2 carries depth, character, name and translation in twips', () => {
    const p = readPlace(parseSwf(T.writeSwf({ widthPx: 1, heightPx: 1, tags: [T.placeObject2({ depth: 4, charId: 9, name: 'label', x: 40.5, y: -2 }), T.endTag()] })).tags[0]!)
    expect(p).toMatchObject({ depth: 4, charId: 9, name: 'label', matrix: { x: 810, y: -40 } })
    expect(p.matrix?.scale).toBeUndefined()
  })

  it('PlaceObject2 rotation and alpha', () => {
    const p = readPlace(parseSwf(T.writeSwf({ widthPx: 1, heightPx: 1, tags: [T.placeObject2({ depth: 1, charId: 1, x: 0, y: 0, rotation: 90, alpha: 0.5 }), T.endTag()] })).tags[0]!)
    expect(p.matrix?.scale?.[0]).toBeCloseTo(0, 3)
    expect(p.matrix?.skew?.[0]).toBeCloseTo(1, 3)
    expect(p.matrix?.skew?.[1]).toBeCloseTo(-1, 3)
    expect(p.alphaMult).toBe(0.5)
    expect(p.name).toBeUndefined()
  })

  it('sprites nest placements before ShowFrame/End; shape placeholder is DefineShape3', () => {
    const buf = T.writeSwf({ widthPx: 1, heightPx: 1, tags: [T.defineShapePlaceholder(1, 400, 80), T.sprite(2, [T.placeObject2({ depth: 1, charId: 1, x: 0, y: 0 })]), T.endTag()] })
    const [shape, spr] = parseSwf(buf).tags
    expect(shape).toMatchObject({ code: T.TAG.DefineShape3 })
    expect(shape!.body.readUInt16LE(0)).toBe(1)
    const inner = spr!.body.subarray(4)
    expect(spr!.body.readUInt16LE(0)).toBe(2)
    expect(spr!.body.readUInt16LE(2)).toBe(1)
    expect(inner.readUInt16LE(0) >> 6).toBe(T.TAG.PlaceObject2)
  })

  it('sbits', () => {
    expect([0, 1, -1, 2, -2, 3, 127, -128, 128].map(T.sbits)).toEqual([1, 2, 1, 3, 2, 3, 8, 8, 9])
  })
})
