// Emits the *skeleton* SWF (no AS code, placeholder shape). FFDec fills in shape + AS2.
// usage: node gen-swf.mjs out.swf [fontMode=class|define] [version=10]
import { writeFileSync } from 'node:fs';
const [out, fontMode = 'class', ver = '10'] = process.argv.slice(2);

class Bits { constructor() { this.b = []; this.cur = 0; this.n = 0; }
  u(v, n) { for (let i = n - 1; i >= 0; i--) { this.cur = (this.cur << 1) | ((v >> i) & 1); if (++this.n === 8) { this.b.push(this.cur); this.cur = 0; this.n = 0; } } }
  s(v, n) { this.u(v & ((1 << n) - 1), n); }
  bytes() { if (this.n) this.u(0, 8 - this.n); return Buffer.from(this.b); } }
const nb = (...v) => 1 + Math.max(...v.map(x => x < 0 ? Math.ceil(Math.log2(-x)) + 1 : (x ? Math.floor(Math.log2(x)) + 1 : 0)), 1);
const rect = (x0, x1, y0, y1) => { const b = new Bits(), n = nb(x0, x1, y0, y1); b.u(n, 5); [x0, x1, y0, y1].forEach(v => b.s(v, n)); return b.bytes(); };
const u8 = v => Buffer.from([v]);
const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const str = s => Buffer.concat([Buffer.from(s, 'utf8'), u8(0)]);
const tag = (code, body) => body.length < 63
  ? Buffer.concat([u16(code << 6 | body.length), body])
  : Buffer.concat([u16(code << 6 | 63), u32(body.length), body]);
const cat = (...a) => Buffer.concat(a);

const W = 200 * 20, H = 40 * 20, E = 0x00;
const SHAPE = 1, TEXT = 2, FONT = 3;

// placeholder 100x100px rect shape, replaced by `-importShapes` from src/shapes/1.svg
function shape() {
  const b = new Bits(); const w = W, h = H; // bounds must match the SVG: importShapes keeps the old bounds
  b.u(1, 4); b.u(0, 4); // numFillBits=1 numLineBits=0
  b.u(0, 1); b.u(0, 1); b.u(0, 1); b.u(0, 1); b.u(1, 1); b.u(1, 1); // style change: fill0 + moveTo
  b.u(1, 5); b.s(0, 1); b.s(0, 1); b.u(1, 1); // move 0,0 ; fill0 = 1
  for (const [dx, dy] of [[w, 0], [0, h], [-w, 0], [0, -h]]) { b.u(1, 1); b.u(1, 1); b.u(14, 4); b.u(1, 1); b.s(dx, 16); b.s(dy, 16); }
  b.u(0, 6);
  return tag(2, cat(u16(SHAPE), rect(0, w, 0, h), u8(1), u8(0), Buffer.from([0x20, 0x20, 0x20]), u8(0), b.bytes()));
}
function editText() {
  const useClass = fontMode === 'class';
  // flags1 (ReadOnly=1 => dynamic, not input): HasText WordWrap Multiline Password ReadOnly HasTextColor HasMaxLength HasFont
  const f1 = 0b1110_1101;
  // flags2: HasFontClass AutoSize HasLayout NoSelect Border WasStatic HTML UseOutlines (dynamic: WasStatic=0, outlines=0 => device font)
  const f2 = useClass ? 0b1001_0000 : 0b0001_0000;
  return tag(37, cat(u16(TEXT), rect(0, 200 * 20, 0, 40 * 20), u8(f1), u8(f2),
    useClass ? cat(u16(0), str('$EverywhereFont')) : u16(FONT), u16(20 * 20), Buffer.from([0xee, 0xee, 0xee, 0xff]),
    str(''), str('INKWELL WIDGET (AS2 NOT RUN)')));
}
// zero-glyph DefineFont2 named like a Flash-IDE device font (variant build only)
const font = () => tag(48, cat(u16(FONT), u8(0b0000_1000 /* WideOffsets */ | 0b00100000 /* SmallText */), u8(0), u8(15), Buffer.from('$EverywhereFont'), u16(0), u32(0)));
const place = (depth, id, x, y, name) => {
  const m = new Bits(); m.u(0, 1); m.u(0, 1); const n = nb(x, y); m.u(n, 5); m.s(x, n); m.s(y, n);
  return tag(26, cat(u8(0b0000_0110 | (name ? 0b0010_0000 : 0)), u16(depth), u16(id), m.bytes(), name ? str(name) : Buffer.alloc(0)));
};

const body = cat(
  tag(9, Buffer.from([0x10, 0x10, 0x10])),
  shape(), fontMode === 'class' ? Buffer.alloc(0) : font(), editText(),
  place(1, SHAPE, 0, 0, ''), place(2, TEXT, 8 * 20, 8 * 20, 'label'),
  tag(12, u8(E)), tag(1, Buffer.alloc(0)), u16(0));
const hdr = rect(0, W, 0, H);
const len = 8 + hdr.length + 4 + body.length;
writeFileSync(out, cat(Buffer.from('FWS'), u8(+ver), u32(len), hdr, u16(30 << 8), u16(1), body));
