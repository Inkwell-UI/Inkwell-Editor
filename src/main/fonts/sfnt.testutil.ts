import { buildNameTable, writeSfnt } from './sfnt'

/** A cmap table with one Windows Unicode BMP subtable (format 4), one single-char segment per code point (glyph ids 1..n). Synthetic; no game data. */
export function cmapFormat4(chars: string): Buffer {
  const cps = [...new Set([...chars].map((c) => c.codePointAt(0)!))].sort((a, b) => a - b)
  const segs = cps.length + 1
  const sub = Buffer.alloc(16 + segs * 8)
  sub.writeUInt16BE(4, 0)
  sub.writeUInt16BE(sub.length, 2)
  sub.writeUInt16BE(segs * 2, 6)
  const [end, start, delta] = [14, 14 + segs * 2 + 2, 14 + segs * 4 + 2]
  cps.forEach((c, i) => {
    sub.writeUInt16BE(c, end + i * 2)
    sub.writeUInt16BE(c, start + i * 2)
    sub.writeUInt16BE((i + 1 - c) & 0xffff, delta + i * 2)
  })
  sub.writeUInt16BE(0xffff, end + cps.length * 2)
  sub.writeUInt16BE(0xffff, start + cps.length * 2)
  sub.writeUInt16BE(1, delta + cps.length * 2)
  const head = Buffer.alloc(12)
  head.writeUInt16BE(1, 2)
  head.writeUInt16BE(3, 4)
  head.writeUInt16BE(1, 6)
  head.writeUInt32BE(12, 8)
  return Buffer.concat([head, sub])
}

/** A cmap with one format 12 subtable mapping [first, last] to glyphs from 1. */
export function cmapFormat12(first: number, last: number): Buffer {
  const head = Buffer.alloc(12)
  head.writeUInt16BE(1, 2)
  head.writeUInt16BE(3, 4)
  head.writeUInt16BE(10, 6)
  head.writeUInt32BE(12, 8)
  const sub = Buffer.alloc(28)
  sub.writeUInt16BE(12, 0)
  sub.writeUInt32BE(28, 4)
  sub.writeUInt32BE(1, 12)
  sub.writeUInt32BE(first, 16)
  sub.writeUInt32BE(last, 20)
  sub.writeUInt32BE(1, 24)
  return Buffer.concat([head, sub])
}

/** A minimal TTF with a name (ID 4 = `full`) and the given cmap, for previewFonts and status tests. */
export const ttfWithCmap = (full: string, cmap: Buffer): Buffer => writeSfnt(new Map([['name', buildNameTable({ 1: full, 4: full })], ['cmap', cmap]]))
