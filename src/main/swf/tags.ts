// Tag-level SWF writer: only the tags the compiler needs. Promoted from the 0.0 spike generator (spikes/ffdec-compile/gen-swf.mjs).
// Everything is uncompressed FWS v10. Layout rules follow the SWF 19 spec; FFDec fills in shape geometry and AS2 afterwards.

export const TWIP = 20
export const twips = (px: number): number => Math.round(px * TWIP)

class Bits {
  private bytes: number[] = []
  private cur = 0
  private n = 0
  u(v: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | (Math.floor(v / 2 ** i) & 1)
      if (++this.n === 8) {
        this.bytes.push(this.cur)
        this.cur = 0
        this.n = 0
      }
    }
  }
  s(v: number, bits: number): void {
    this.u(v < 0 ? v + 2 ** bits : v, bits)
  }
  done(): Buffer {
    if (this.n) this.u(0, 8 - this.n)
    return Buffer.from(this.bytes)
  }
}

/** Minimal signed bit width of v (two's complement). */
export function sbits(v: number): number {
  const m = v < 0 ? -v - 1 : v
  return (m === 0 ? 0 : Math.floor(Math.log2(m)) + 1) + 1
}

const u8 = (v: number): Buffer => Buffer.from([v & 0xff])
const u16 = (v: number): Buffer => {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(v & 0xffff)
  return b
}
const s16 = (v: number): Buffer => {
  const b = Buffer.alloc(2)
  b.writeInt16LE(Math.max(-32768, Math.min(32767, v)))
  return b
}
const u32 = (v: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(v)
  return b
}
const str = (s: string): Buffer => Buffer.concat([Buffer.from(s, 'utf8'), u8(0)])
const cat = (...a: Buffer[]): Buffer => Buffer.concat(a)

export function rect(x0: number, x1: number, y0: number, y1: number): Buffer {
  const n = Math.max(sbits(x0), sbits(x1), sbits(y0), sbits(y1))
  const b = new Bits()
  b.u(n, 5)
  for (const v of [x0, x1, y0, y1]) b.s(v, n)
  return b.done()
}

export const TAG = {
  End: 0,
  ShowFrame: 1,
  DefineShape3: 32,
  SetBackgroundColor: 9,
  DoAction: 12,
  PlaceObject2: 26,
  DefineEditText: 37,
  DefineSprite: 39,
  ExportAssets: 56,
  DoInitAction: 59,
  ImportAssets2: 71
} as const

export function tag(code: number, body: Buffer = Buffer.alloc(0)): Buffer {
  return body.length < 63 ? cat(u16((code << 6) | body.length), body) : cat(u16((code << 6) | 63), u32(body.length), body)
}

export const setBackgroundColor = (r: number, g: number, b: number): Buffer => tag(TAG.SetBackgroundColor, Buffer.from([r, g, b]))
export const showFrame = (): Buffer => tag(TAG.ShowFrame)
export const endTag = (): Buffer => tag(TAG.End)
/** Placeholder (ActionEnd); FFDec -importScript fills frame_N/DoAction.as. */
export const doAction = (): Buffer => tag(TAG.DoAction, u8(0))
export const doInitAction = (spriteId: number): Buffer => tag(TAG.DoInitAction, cat(u16(spriteId), u8(0)))

/** Sprite whose timeline holds `controlTags` (PlaceObject2 ...) in one frame. An empty one carries an exported AS2 class. */
export function sprite(id: number, controlTags: Buffer[] = []): Buffer {
  return tag(TAG.DefineSprite, cat(u16(id), u16(1), ...controlTags, showFrame(), endTag()))
}

export const exportAssets = (items: { id: number; name: string }[]): Buffer =>
  tag(TAG.ExportAssets, cat(u16(items.length), ...items.flatMap((i) => [u16(i.id), str(i.name)])))

/**
 * ImportAssets2 of ONE asset (a font alias from gfxfontlib.swf into a local character id). Vanilla menus use one tag per font; with several
 * assets in one tag only the first resolved in game, the rest drew .notdef boxes (in-game test sheet, 2026-10-23).
 */
export const importAssets2 = (url: string, item: { id: number; name: string }): Buffer =>
  tag(TAG.ImportAssets2, cat(str(url), u8(1), u8(0), u16(1), u16(item.id), str(item.name)))

/**
 * Placeholder DefineShape3 (RGBA, so the imported fills keep their alpha): a filled rect with the node's bounds. `-importShapes` replaces the geometry but KEEPS these bounds
 * (spike finding), so they must match the SVG's size.
 */
export function defineShapePlaceholder(id: number, wPx: number, hPx: number): Buffer {
  const w = Math.min(Math.max(twips(wPx), 1), 65000)
  const h = Math.min(Math.max(twips(hPx), 1), 65000)
  const nb = Math.min(Math.max(sbits(w), sbits(h), 2), 17)
  const b = new Bits()
  b.u(1, 4) // numFillBits
  b.u(0, 4) // numLineBits
  b.u(0, 1) // style change record
  b.u(0, 1) // new styles
  b.u(0, 1) // line style
  b.u(0, 1) // fill1
  b.u(1, 1) // fill0
  b.u(1, 1) // moveTo
  b.u(1, 5)
  b.s(0, 1)
  b.s(0, 1)
  b.u(1, 1) // fill0 = 1
  for (const [dx, dy] of [[w, 0], [0, h], [-w, 0], [0, -h]] as const) {
    b.u(1, 1) // edge
    b.u(1, 1) // straight
    b.u(nb - 2, 4)
    b.u(1, 1) // general line
    b.s(dx, nb)
    b.s(dy, nb)
  }
  b.u(0, 6) // end of shape
  return tag(TAG.DefineShape3, cat(u16(id), rect(0, twips(wPx), 0, twips(hPx)), u8(1), u8(0), Buffer.from([0x20, 0x20, 0x20, 0xff]), u8(0), b.done()))
}

export interface EditTextSpec {
  id: number
  /** Field size in px, including the 2px gutter on each side. */
  wPx: number
  hPx: number
  /** Character id of the imported font (ImportAssets2). */
  fontId: number
  /** Preview only: a device font class (`_sans`...) instead of fontId + outlines. Draws nothing in Skyrim; Ruffle renders it. */
  fontClass?: string
  sizePx: number
  color: { r: number; g: number; b: number; a: number }
  text: string
  wordWrap: boolean
  multiline: boolean
  autoSize: boolean
  /** 0 left, 1 right, 2 center, 3 justify. */
  align: number
  leadingPx: number
}

/**
 * Variant A (proven in game): dynamic, read-only, HasFont + FontID, UseOutlines, never FontClass.
 * flags1: HasText WordWrap Multiline Password ReadOnly HasTextColor HasMaxLength HasFont
 * flags2: HasFontClass AutoSize HasLayout NoSelect Border WasStatic HTML UseOutlines
 */
export function defineEditText(t: EditTextSpec): Buffer {
  const f1 = 0x80 | (t.wordWrap ? 0x40 : 0) | (t.multiline ? 0x20 : 0) | 0x08 | 0x04 | 0x01
  // device font (preview): HasFontClass, no UseOutlines
  const f2 = (t.autoSize ? 0x40 : 0) | 0x20 | (t.fontClass ? 0x80 : 0x01)
  return tag(
    TAG.DefineEditText,
    cat(
      u16(t.id), rect(0, twips(t.wPx), 0, twips(t.hPx)), u8(f1), u8(f2),
      u16(t.fontClass ? 0 : t.fontId), t.fontClass ? str(t.fontClass) : Buffer.alloc(0), u16(twips(t.sizePx)), Buffer.from([t.color.r, t.color.g, t.color.b, t.color.a]),
      u8(t.align), u16(0), u16(0), u16(0), s16(twips(t.leadingPx)), // layout: align, margins, indent, leading
      str(''), str(t.text)
    )
  )
}

export interface Placement {
  depth: number
  charId: number
  name?: string
  x: number
  y: number
  /** Degrees, clockwise on screen (Flash convention). */
  rotation?: number
  /** 0..1, applied as an alpha multiplier colour transform. */
  alpha?: number
  /** Uniform scale factor (not combined with `rotation`). */
  scale?: number
}

export function placeObject2(p: Placement): Buffer {
  const hasCx = p.alpha !== undefined && p.alpha < 1
  const flags = 0x04 | 0x02 | (hasCx ? 0x08 : 0) | (p.name ? 0x20 : 0)
  const m = new Bits()
  const rot = p.rotation ?? 0
  if (rot !== 0) {
    const r = (rot * Math.PI) / 180
    const fx = (v: number) => Math.round(v * 65536)
    const c = fx(Math.cos(r))
    const s = fx(Math.sin(r))
    const n = Math.max(sbits(c), sbits(s))
    m.u(1, 1); m.u(n, 5); m.s(c, n); m.s(c, n) // scale x/y = cos
    m.u(1, 1); m.u(n, 5); m.s(s, n); m.s(-s, n) // rotateSkew0 = sin, rotateSkew1 = -sin
  } else if (p.scale !== undefined && p.scale !== 1) {
    const f = Math.round(p.scale * 65536)
    const n = sbits(f)
    m.u(1, 1); m.u(n, 5); m.s(f, n); m.s(f, n) // HasScale, no rotate/skew
    m.u(0, 1)
  } else {
    m.u(0, 1); m.u(0, 1)
  }
  const x = twips(p.x)
  const y = twips(p.y)
  const n = Math.max(sbits(x), sbits(y))
  m.u(n, 5); m.s(x, n); m.s(y, n)
  const cx = new Bits()
  if (hasCx) {
    cx.u(0, 1); cx.u(1, 1); cx.u(10, 4) // no add terms, mult terms, 10 bits each
    for (const v of [256, 256, 256, Math.round(p.alpha! * 256)]) cx.s(v, 10)
  }
  return tag(
    TAG.PlaceObject2,
    cat(u8(flags), u16(p.depth), u16(p.charId), m.done(), hasCx ? cx.done() : Buffer.alloc(0), p.name ? str(p.name) : Buffer.alloc(0))
  )
}

/** Assembles an FWS file: header (stage in px), 30 fps, one frame, then the tag bytes (caller ends with ShowFrame + End). */
export function writeSwf(opts: { version?: number; widthPx: number; heightPx: number; tags: Buffer[] }): Buffer {
  const body = cat(rect(0, twips(opts.widthPx), 0, twips(opts.heightPx)), u16(30 << 8), u16(1), ...opts.tags)
  return cat(Buffer.from('FWS'), u8(opts.version ?? 10), u32(8 + body.length), body)
}
