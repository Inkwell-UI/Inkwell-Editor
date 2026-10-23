// Emits the *skeleton* SWF (no AS code, placeholder shape). FFDec fills in shape + AS2.
// usage: node gen-swf.mjs out.swf [fontMode=class|import|define] [version=10]
//   class : fontClass $EverywhereFont, device text (variant B, the original build; invisible in-game)
//   import: ImportAssets2 gfxfontlib.swf/$EverywhereMediumFont + fontId + UseOutlines, exactly like vanilla menus (variant A)
//   arg4 'd': variant D layout (BOXES instead of the single report field)
//   define: local zero-glyph DefineFont2 '$EverywhereFont' + fontId + UseOutlines, no import (variant C)
import { writeFileSync } from 'node:fs';
const [out, fontMode = 'class', ver = '10', layout = ''] = process.argv.slice(2);
const D = layout === 'd'; // variant D: many bordered test boxes + labels (import font encoding), see BOXES

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

const W = 1280 * 20, H = 720 * 20, E = 0x00; // E = ActionEnd placeholder
const SHAPE = 1, TEXT = 2, FONT = 3, SPR_P1 = 10, SPR_P2 = 11, SPR_CLIP = 12;

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
  // flags2: HasFontClass AutoSize HasLayout NoSelect Border WasStatic HTML UseOutlines
  // class = device font (outlines=0); import/define set UseOutlines like every vanilla menu text field
  const f2 = useClass ? 0b1001_0000 : 0b0001_0001;
  return tag(37, cat(u16(TEXT), rect(0, 1200 * 20, 0, 640 * 20), u8(f1), u8(f2),
    useClass ? cat(u16(0), str('$EverywhereFont')) : u16(FONT), u16(16 * 20), Buffer.from([0xee, 0xee, 0xee, 0xff]),
    str(''), str(`INKWELL SPIKE (font=${fontMode}): AS2 NOT RUN`)));
}
// A: vanilla menus import the font from 'gfxfontlib.swf' (GFx resolves it via fontconfig.txt, gfxfontlib itself does not export it)
// C: zero-glyph DefineFont2 named like a Flash-IDE device font
const importFont = () => tag(71, cat(str('gfxfontlib.swf'), u8(1), u8(0), u16(1), u16(FONT), str('$EverywhereMediumFont')));
const font = () => tag(48, cat(u16(FONT), u8(0b0000_1000 /* WideOffsets */ | 0b00100000 /* SmallText */), u8(0), u8(15), Buffer.from('$EverywhereFont'), u16(0), u32(0)));
const sprite = id => tag(39, cat(u16(id), u16(1), tag(1, Buffer.alloc(0)), u16(0)));
const place = (depth, id, x, y, name) => {
  const m = new Bits(); m.u(0, 1); m.u(0, 1); const n = nb(x, y); m.u(n, 5); m.s(x, n); m.s(y, n);
  return tag(26, cat(u8(0b0000_0110 | (name ? 0b0010_0000 : 0)), u16(depth), u16(id), m.bytes(), name ? str(name) : Buffer.alloc(0)));
};
const exports = tag(56, cat(u16(3), u16(SPR_P1), str('__Packages.mods.inkwellspike.Probe'),
  u16(SPR_P2), str('__Packages.mods.other.Probe'), u16(SPR_CLIP), str('InkwellProbeClip')));
const init = id => tag(59, cat(u16(id), u8(E)));

// variant D: [instance, x, y, w, h, size, initial text]; l_* = labels, rest = bordered test boxes
const LONG = 'The quick brown fox jumps over the lazy dog. '.repeat(4), SHORT = 'Short text';
const BOXES = [['hdr', 40, 4, 600, 20, 14, 'INKWELL SPIKE D: GFx TextField extensions (see README)'],
  ...['top', 'center', 'bottom'].flatMap((v, i) => [[`l_v_${v}`, 40 + i * 220, 28, 210, 18, 13, `verticalAlign='${v}'`], [`v_${v}`, 40 + i * 220, 48, 200, 150, 18, SHORT]]),
  ...['none', 'shrink', 'fit'].flatMap((v, i) => [[`l_a_${v}`, 40 + i * 220, 218, 210, 18, 13, `textAutoSize='${v}'`], [`a_${v}`, 40 + i * 220, 238, 200, 70, 16, LONG]]),
  ...[['none', 'no shadowStyle'], ['shadow', "shadowStyle='shadow'"], ['params', "shadow + shadow* props"]].flatMap(([v, t], i) => [[`l_s_${v}`, 40 + i * 220, 328, 210, 18, 13, t], [`s_${v}`, 40 + i * 220, 348, 200, 60, 28, 'Shadow']]),
  ['info', 700, 28, 560, 660, 12, 'INFO: AS2 NOT RUN']];
function boxFields() {
  return BOXES.map(([, , , w, h, size, text], i) => tag(37, cat(u16(TEXT + 100 + i), rect(0, w * 20, 0, h * 20), u8(0b1110_1101), u8(0b0001_0001),
    u16(FONT), u16(size * 20), Buffer.from([0xee, 0xee, 0xee, 0xff]), str(''), str(text))));
}
const boxPlaces = () => BOXES.map(([name, x, y], i) => place(3 + i, TEXT + 100 + i, x * 20, y * 20, name));

const body = cat(
  tag(9, Buffer.from([0x10, 0x10, 0x10])),
  shape(), { class: Buffer.alloc(0), import: importFont(), define: font() }[fontMode], D ? cat(...boxFields()) : editText(),
  sprite(SPR_P1), sprite(SPR_P2), sprite(SPR_CLIP), exports,
  init(SPR_P1), init(SPR_P2),
  place(1, SHAPE, 0, 0, ''), ...(D ? boxPlaces() : [place(2, TEXT, 40 * 20, 40 * 20, 'report')]),
  tag(12, u8(E)), tag(1, Buffer.alloc(0)), u16(0));
const hdr = rect(0, W, 0, H);
const len = 8 + hdr.length + 4 + body.length;
writeFileSync(out, cat(Buffer.from('FWS'), u8(+ver), u32(len), hdr, u16(30 << 8), u16(1), body));
