// Test-only SWF reader: parses what tags.ts writes, independently of the writer's helpers.
import { TAG } from './tags'

class R {
  pos = 0
  bit = 0
  constructor(readonly b: Buffer) {}
  u8(): number { this.align(); return this.b[this.pos++]! }
  u16(): number { this.align(); const v = this.b.readUInt16LE(this.pos); this.pos += 2; return v }
  s16(): number { this.align(); const v = this.b.readInt16LE(this.pos); this.pos += 2; return v }
  u32(): number { this.align(); const v = this.b.readUInt32LE(this.pos); this.pos += 4; return v }
  str(): string { this.align(); const e = this.b.indexOf(0, this.pos); const s = this.b.toString('utf8', this.pos, e); this.pos = e + 1; return s }
  align(): void { if (this.bit) { this.bit = 0; this.pos++ } }
  ub(n: number): number {
    let v = 0
    for (let i = 0; i < n; i++) {
      v = v * 2 + ((this.b[this.pos]! >> (7 - this.bit)) & 1)
      if (++this.bit === 8) { this.bit = 0; this.pos++ }
    }
    return v
  }
  sb(n: number): number { const v = this.ub(n); return v >= 2 ** (n - 1) ? v - 2 ** n : v }
  rect(): { x0: number; x1: number; y0: number; y1: number } {
    const n = this.ub(5)
    const r = { x0: this.sb(n), x1: this.sb(n), y0: this.sb(n), y1: this.sb(n) }
    this.align()
    return r
  }
}

export interface RawTag { code: number; body: Buffer }
export interface ParsedSwf { signature: string; version: number; length: number; frameSize: ReturnType<R['rect']>; frameRate: number; frames: number; tags: RawTag[] }

export function parseTags(buf: Buffer): RawTag[] {
  const tags: RawTag[] = []
  let p = 0
  while (p < buf.length) {
    const h = buf.readUInt16LE(p)
    p += 2
    let len = h & 63
    if (len === 63) { len = buf.readUInt32LE(p); p += 4 }
    tags.push({ code: h >> 6, body: buf.subarray(p, p + len) })
    p += len
    if (h >> 6 === 0) break
  }
  return tags
}

export function parseSwf(buf: Buffer): ParsedSwf {
  const r = new R(buf)
  r.pos = 8
  const frameSize = r.rect()
  const frameRate = r.u16() / 256
  const frames = r.u16()
  return { signature: buf.toString('ascii', 0, 3), version: buf[3]!, length: buf.readUInt32LE(4), frameSize, frameRate, frames, tags: parseTags(buf.subarray(r.pos)) }
}

export function readImportAssets2(t: RawTag): { url: string; items: { id: number; name: string }[] } {
  const r = new R(t.body)
  const url = r.str()
  r.u8(); r.u8()
  const n = r.u16()
  return { url, items: Array.from({ length: n }, () => ({ id: r.u16(), name: r.str() })) }
}

export function readEditText(t: RawTag) {
  const r = new R(t.body)
  const id = r.u16()
  const bounds = r.rect()
  const f1 = r.u8()
  const f2 = r.u8()
  const o = {
    id, bounds,
    hasText: !!(f1 & 0x80), wordWrap: !!(f1 & 0x40), multiline: !!(f1 & 0x20), readOnly: !!(f1 & 8), hasTextColor: !!(f1 & 4), hasFont: !!(f1 & 1),
    hasFontClass: !!(f2 & 0x80), autoSize: !!(f2 & 0x40), hasLayout: !!(f2 & 0x20), wasStatic: !!(f2 & 4), html: !!(f2 & 2), useOutlines: !!(f2 & 1)
  }
  const fontId = o.hasFont ? r.u16() : undefined
  const fontClass = o.hasFontClass ? r.str() : undefined
  const fontHeight = r.u16()
  const color = { r: r.u8(), g: r.u8(), b: r.u8(), a: r.u8() }
  const layout = { align: r.u8(), leftMargin: r.u16(), rightMargin: r.u16(), indent: r.u16(), leading: r.s16() }
  r.str()
  return { ...o, fontId, fontClass, fontHeight, color, layout, text: r.str() }
}

export function readPlace(t: RawTag) {
  const r = new R(t.body)
  const flags = r.u8()
  const depth = r.u16()
  const charId = flags & 2 ? r.u16() : undefined
  let matrix: { scale?: [number, number]; skew?: [number, number]; x: number; y: number } | undefined
  if (flags & 4) {
    let scale: [number, number] | undefined
    let skew: [number, number] | undefined
    if (r.ub(1)) { const n = r.ub(5); scale = [r.sb(n) / 65536, r.sb(n) / 65536] }
    if (r.ub(1)) { const n = r.ub(5); skew = [r.sb(n) / 65536, r.sb(n) / 65536] }
    const n = r.ub(5)
    matrix = { ...(scale ? { scale } : {}), ...(skew ? { skew } : {}), x: r.sb(n), y: r.sb(n) }
    r.align()
  }
  let alphaMult: number | undefined
  if (flags & 8) {
    const add = r.ub(1), mult = r.ub(1), n = r.ub(4)
    if (mult) { r.sb(n); r.sb(n); r.sb(n); alphaMult = r.sb(n) / 256 }
    if (add) throw new Error('unexpected add terms')
    r.align()
  }
  const name = flags & 0x20 ? r.str() : undefined
  return { depth, charId, matrix, alphaMult, name }
}

export const isTag = (code: number) => (t: RawTag) => t.code === code
export { TAG }
