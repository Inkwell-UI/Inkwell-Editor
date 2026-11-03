import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { withoutImports } from './previewArt'
import * as T from './tags'

/** The tag codes of an uncompressed SWF body. */
function codes(swf: Buffer): number[] {
  const body = swf.subarray(8)
  let at = Math.ceil((5 + 4 * (body[0]! >> 3)) / 8) + 4
  const out: number[] = []
  while (at + 2 <= body.length) {
    const h = body.readUInt16LE(at)
    let len = h & 0x3f
    let hdr = 2
    if (len === 0x3f) { len = body.readUInt32LE(at + 2); hdr = 6 }
    out.push(h >> 6)
    at += hdr + len
  }
  return out
}

describe('withoutImports', () => {
  const tags = [T.setBackgroundColor(0, 0, 0), T.importAssets2('gfxfontlib.swf', { id: 1, name: '$EverywhereMediumFont' }), T.showFrame(), T.endTag()]
  const swf = T.writeSwf({ widthPx: 100, heightPx: 100, tags })
  it('drops the import tags and keeps the rest, with a correct length', () => {
    expect(codes(swf)).toContain(71)
    const out = withoutImports(swf)
    expect(codes(out)).not.toContain(71)
    expect(codes(out)).toEqual(expect.arrayContaining([9, 1, 0]))
    expect(out.readUInt32LE(4)).toBe(out.length)
  })
  it('reads a compressed file too', () => {
    const body = swf.subarray(8)
    const cws = Buffer.concat([Buffer.from('CWS'), swf.subarray(3, 8), deflateSync(body)])
    expect(codes(withoutImports(cws))).not.toContain(71)
  })
  it('returns anything it does not understand unchanged', () => {
    const junk = Buffer.from('not a swf at all')
    expect(withoutImports(junk)).toBe(junk)
  })
})
