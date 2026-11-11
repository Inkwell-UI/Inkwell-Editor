// Content of the in-game 9-slice / 3-slice test (docs/images.md, "Slice test"): one sheet per image mode, the same cases in both.
// Captions, background and title are an ordinary IR (compiled by the editor like any menu); the images and their AS2 are added by `extend` (scripts/compile-slice-test.ts).
import { Swf } from '@inkwell-ui/spec'
import type { ImageMode } from '../src/main/images/assets'
import { syntheticSlice } from '../src/main/images/synthetic'
import type { Generated } from '../src/main/swf/generate'
import * as T from '../src/main/swf/tags'

export const MOD_ID = 'SliceTest'
export const SHEETS = [
  { id: 'slicetest', menu: 'InkwellSliceTest', mode: 'embedded' as ImageMode, hotkey: 72, key: 'Numpad 8' },
  { id: 'slicetestdds', menu: 'InkwellSliceTestDds', mode: 'dds' as ImageMode, hotkey: 73, key: 'Numpad 9' }
] as const

export type ImgKey = 'panel' | 'hbar' | 'vbar'
/** Source images: a 9-slice panel (corners 24), a horizontal 3-slice bar (ends 8) and a vertical one. `g` = the slice rectangle in source px. */
export const IMGS: Record<ImgKey, { w: number; h: number; g: { x: number; y: number; w: number; h: number }; s: ReturnType<typeof syntheticSlice> }> = {
  panel: { w: 128, h: 128, g: { x: 24, y: 24, w: 80, h: 80 }, s: syntheticSlice(128, 128, { l: 24, t: 24, r: 24, b: 24 }) },
  hbar: { w: 128, h: 16, g: { x: 8, y: 0, w: 112, h: 16 }, s: syntheticSlice(128, 16, { l: 8, t: 0, r: 8, b: 0 }, 4) },
  vbar: { w: 16, h: 128, g: { x: 0, y: 8, w: 16, h: 112 }, s: syntheticSlice(16, 128, { l: 0, t: 8, r: 0, b: 8 }, 4) }
}

/**
 * How the slice reaches the clip:
 *  raw   no slicing, native size (reference)      none  no slicing, resized (control: must look stretched)
 *  A     `clip.scale9Grid = Rectangle`, then _width/_height (runtime API on the image clip)
 *  B     same on a holder clip that contains the image clip
 *  T     the grid is a DefineScalingGrid tag in the SWF and the clip is placed with a scale matrix (embedded only)
 *  T2    the tag grid, then _width/_height from AS2 (embedded only)
 *  Dn/D  a VECTOR panel drawn from AS2 (drawing API), resized without / with scale9Grid: does the game honour scale9Grid at all?
 *  F     the fallback: the panel cut into 9 bitmap pieces, each placed and scaled on its own (embedded only)
 */
export type Method = 'raw' | 'none' | 'A' | 'B' | 'T' | 'T2' | 'Dn' | 'D' | 'F'
export interface Case { id: string; img: ImgKey; method: Method; x: number; y: number; w: number; h: number; note: string; /** dds only: the image URL with `{h}` for the hash, instead of the usual one. */ urlForm?: string }

const c = (id: string, img: ImgKey, method: Method, x: number, y: number, w: number, h: number, note: string): Case => ({ id, img, method, x, y, w, h, note })
export const CASES: Case[] = [
  c('P0', 'panel', 'raw', 30, 100, 128, 128, 'raw 128x128'),
  c('P1', 'panel', 'none', 270, 100, 200, 140, 'no slice, resized (control)'),
  c('P2', 'panel', 'A', 510, 100, 200, 140, 'A: grid on the clip'),
  c('P3', 'panel', 'B', 750, 100, 200, 140, 'B: grid on a holder'),
  c('P4', 'panel', 'T', 990, 100, 200, 140, 'T: grid tag + scale matrix'),
  c('P5', 'panel', 'T2', 30, 330, 200, 140, 'T2: grid tag + _width/_height'),
  c('P6', 'panel', 'A', 270, 330, 48, 48, 'A at 48x48 (= both insets)'),
  c('P7', 'panel', 'A', 510, 330, 40, 40, 'A at 40x40 (< both insets)'),
  c('V0', 'vbar', 'raw', 760, 330, 16, 128, 'raw'),
  c('V1', 'vbar', 'none', 830, 330, 16, 240, 'none'),
  c('V2', 'vbar', 'A', 900, 330, 16, 240, 'A'),
  c('V3', 'vbar', 'B', 970, 330, 16, 240, 'B'),
  c('V4', 'vbar', 'T', 1040, 330, 16, 240, 'T'),
  c('H0', 'hbar', 'raw', 30, 610, 128, 16, 'raw'),
  c('H1', 'hbar', 'none', 190, 610, 240, 16, 'none (control)'),
  c('H2', 'hbar', 'A', 450, 610, 240, 16, 'A'),
  c('H3', 'hbar', 'B', 710, 610, 240, 16, 'B'),
  c('H4', 'hbar', 'T', 970, 610, 240, 16, 'T'),
  c('D0', 'panel', 'Dn', 30, 505, 160, 90, 'vector, no slice'),
  c('D1', 'panel', 'D', 230, 505, 160, 90, 'vector + scale9Grid'),
  c('F1', 'panel', 'F', 430, 505, 160, 90, 'F: 9 pieces (fallback)'),
  { ...c('U2', 'panel', 'raw', 990, 100, 128, 128, 'url Inkwell/SliceTest/..'), urlForm: 'img://Inkwell/SliceTest/{h}.dds' },
  { ...c('U3', 'panel', 'raw', 1130, 100, 128, 128, 'url Textures/ (capital)'), urlForm: 'img://Textures/Inkwell/SliceTest/{h}.dds' },
  { ...c('U4', 'panel', 'raw', 1090, 330, 128, 128, 'url with backslashes'), urlForm: 'img://textures\\\\Inkwell\\\\SliceTest\\\\{h}.dds' },
  { ...c('U5', 'panel', 'raw', 1090, 480, 128, 128, 'url without .dds'), urlForm: 'img://textures/Inkwell/SliceTest/{h}' }
]
const embeddedOnly = (m: Method): boolean => m === 'T' || m === 'T2' || m === 'F'
export const casesFor = (mode: ImageMode): Case[] => CASES.filter((k) => (mode === 'embedded' ? !k.urlForm : !embeddedOnly(k.method)))

/** Background, title, legend and one caption per case. */
export function buildSliceSheet(id: string, mode: ImageMode): Swf {
  const nodes: Record<string, unknown> = {}
  const kids: string[] = []
  let n = 1
  const col = (h: string) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 })
  const add = (type: string, name: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown>): void => {
    const nid = `1:${++n}`
    nodes[nid] = { id: nid, name, parent: '1:1', children: [], transform: { x, y, width: w, height: h, rotation: 0 }, anchor: { h: 'left', v: 'top' }, visible: true, opacity: 1, type, ...extra }
    kids.push(nid)
  }
  const text = (name: string, x: number, y: number, content: string, size = 12, color = '#ffffff', font = '$EverywhereFont'): void =>
    add('text', name, x, y, Math.ceil(content.length * size * 0.6), Math.ceil(size * 1.3), {
      content, sizing: 'autoWidth', align: 'left', verticalAlign: 'top', lineHeight: { unit: 'auto' }, letterSpacing: { unit: 'px', value: 0 }, textFit: 'none', truncate: false,
      runs: [{ start: 0, end: content.length, font: { kind: 'alias', name: font }, size, fill: { type: 'solid', color: col(color) } }]
    })
  add('shape', 'background', 0, 0, 1280, 720, { paths: [[{ op: 'M', x: 0, y: 0 }, { op: 'L', x: 1280, y: 0 }, { op: 'L', x: 1280, y: 720 }, { op: 'L', x: 0, y: 720 }, { op: 'Z' }]], fills: [{ type: 'solid', color: col('#14161c') }], strokes: [] })
  text('title', 20, 10, `INKWELL SLICE TEST - ${mode === 'dds' ? 'DDS MODE (img://textures/Inkwell/SliceTest/<hash>.dds)' : 'EMBEDDED MODE (bitmaps inside the SWF)'}`, 20, '#ffd24a', '$EverywhereBoldFont')
  text('legend', 20, 40, 'RIGHT: orange corners stay ROUND and keep their size (24 px panel, 8 px bars); only the teal edges and the checkered centre grow. Bars grow in one direction only.', 12, '#aab0bc')
  text('legend2', 20, 56, 'WRONG: oval / smeared corners (grid ignored, looks like the control), a blank spot (that case does not work), or a broken picture. Report each case id as right / wrong / blank.', 12, '#aab0bc')
  text('legend3', 20, 72, mode === 'dds' ? 'T, T2 and F exist only in the embedded menu; U2-U5 only here (other ways to write the image URL; P0 is the usual one).' : 'T and T2 use a DefineScalingGrid tag in the SWF; A and B set scale9Grid from AS2; D0/D1 are drawn vectors; F cuts the panel into 9 bitmap pieces.', 12, '#aab0bc')
  for (const k of casesFor(mode)) text(`caption ${k.id}`, k.x, k.y + k.h + 6, `${k.id}  ${k.note}`, 12)
  return Swf.parse({
    specVersion: 4, id, name: id, target: { kind: 'customMenu' }, stage: { width: 1280, height: 720 }, root: '1:1',
    nodes: { '1:1': { id: '1:1', name: 'root', parent: null, children: kids, transform: { x: 0, y: 0, width: 1280, height: 720, rotation: 0 }, anchor: { h: 'left', v: 'top' }, visible: true, opacity: 1, type: 'frame', clipContent: false }, ...nodes }
  })
}

const BASE_ID = 5000 // character ids of this test; the generated sheet uses small ones
const BASE_DEPTH = 1000 // above everything the sheet places

const AS2_HELPERS = `
// frame 1 runs before the runtime installs _root.inkwellTrace: lines wait in a buffer and are flushed once it exists
var slBuf = [];
function slFlush() {
    if (_root.inkwellTrace == undefined) return;
    while (slBuf.length > 0) _root.inkwellTrace(slBuf.shift());
    clearInterval(slTimer);
}
function slLog(s) { trace(s); slBuf.push(s); }
var slTimer = setInterval(slFlush, 100);
function slDraw(host, depth) {
    var c = host.createEmptyMovieClip("c", depth);
    var r = function(x, y, w, h, col) { c.beginFill(col, 100); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.lineTo(x, y); c.endFill(); };
    r(0, 0, 128, 128, 0x28A0AA);
    r(24, 24, 80, 80, 0x32406E);
    r(0, 0, 24, 24, 0xF08C1E); r(104, 0, 24, 24, 0xF08C1E); r(0, 104, 24, 24, 0xF08C1E); r(104, 104, 24, 24, 0xF08C1E);
    r(9, 9, 6, 6, 0xFFFFFF); r(113, 9, 6, 6, 0xFFFFFF); r(9, 113, 6, 6, 0xFFFFFF); r(113, 113, 6, 6, 0xFFFFFF);
    return c;
}
function slVector(id, method, x, y, w, h, g, depth) {
    var tag = "[SliceTest] " + id + " (" + method + ")";
    try {
        var host = _root.createEmptyMovieClip("h_" + id, depth);
        host._x = x; host._y = y;
        var t = slDraw(host, 1);
        slApply(host, t, method == "D" ? "A" : "none", w, h, g, tag);
    } catch (e) { slLog(tag + ": " + e); }
}
function slGrid(mc, g, tag) {
    try {
        // flash.geom.Rectangle is missing in Skyrim's GFx (seen in game): try a plain object with the same members
        var rect;
        if (typeof flash.geom.Rectangle == "function") rect = new flash.geom.Rectangle(g[0], g[1], g[2], g[3]);
        else { rect = new Object(); rect.x = g[0]; rect.y = g[1]; rect.width = g[2]; rect.height = g[3]; }
        slLog(tag + ": before: typeof scale9Grid = " + typeof mc.scale9Grid + ", Rectangle " + (typeof flash.geom.Rectangle == "function" ? "exists" : "missing, using a plain object"));
        mc.scale9Grid = rect;
        var r = mc.scale9Grid;
        slLog(tag + ": scale9Grid set, read back " + (r == undefined ? "undefined (property not supported?)" : r.x + "," + r.y + "," + r.width + "," + r.height));
    } catch (e) { slLog(tag + ": scale9Grid threw " + e); }
}
function slSize(mc, w, h, tag) {
    try {
        slLog(tag + ": size before " + mc._width + "x" + mc._height);
        mc._width = w; mc._height = h;
        slLog(tag + ": size after " + mc._width + "x" + mc._height + " (wanted " + w + "x" + h + ")");
    } catch (e) { slLog(tag + ": sizing threw " + e); }
}
// method: none | A | B | T2 (sizing by AS2); raw leaves the native size
function slApply(host, t, method, w, h, g, tag) {
    if (method == "none" || method == "T2") slSize(t, w, h, tag);
    else if (method == "A") { slGrid(t, g, tag); slSize(t, w, h, tag); }
    else if (method == "B") { slGrid(host, g, tag); slSize(host, w, h, tag); }
    else slLog(tag + ": native size " + t._width + "x" + t._height);
}
function slEmbedded(id, link, method, x, y, w, h, g, depth) {
    var tag = "[SliceTest] " + id + " (" + method + ")";
    try {
        var host = _root.createEmptyMovieClip("h_" + id, depth);
        host._x = x; host._y = y;
        var t = host.attachMovie(link, "c", 1);
        if (t == undefined) { slLog(tag + ": attachMovie " + link + " failed"); return; }
        slApply(host, t, method, w, h, g, tag);
    } catch (e) { slLog(tag + ": " + e); }
}
function slDds(id, url, method, x, y, w, h, g, depth) {
    var tag = "[SliceTest] " + id + " (" + method + ")";
    try {
        var host = _root.createEmptyMovieClip("h_" + id, depth);
        host._x = x; host._y = y;
        var c = host.createEmptyMovieClip("c", 1);
        var l = new MovieClipLoader();
        var o = new Object();
        o.onLoadInit = function(t) { slLog(tag + ": loaded " + url + ", reports " + t._width + "x" + t._height); slApply(host, t, method, w, h, g, tag); };
        o.onLoadError = function(t, err) { slLog(tag + ": FAILED to load " + url + ": " + err); };
        l.addListener(o);
        l.loadClip(url, c);
    } catch (e) { slLog(tag + ": " + e); }
}
slLog("[SliceTest] start, player " + (typeof System == "object" ? System.capabilities.version : "?"));
`

/** Adds this test's bitmaps, slice sprites, static placements (method T) and AS2 to the generated sheet. */
export function extendSliceSheet(mode: ImageMode, ddsUrl: (hash: string) => string): (g: Generated) => Generated {
  return (g) => {
    const defs: Buffer[] = []
    const places: Buffer[] = []
    const exports: { id: number; name: string }[] = []
    const ids: Record<string, { plain: number; grid: number; bitmap: number }> = {}
    let next = BASE_ID
    if (mode === 'embedded')
      for (const [key, im] of Object.entries(IMGS)) {
        const bitmap = next++, shape = next++, plain = next++, grid = next++
        defs.push(T.defineBitsLossless2(bitmap, im.s.image), T.defineBitmapShape({ id: shape, bitmapId: bitmap, rect: { x: 0, y: 0, w: im.w, h: im.h }, scale: 1, tx: 0, ty: 0 }))
        defs.push(T.sprite(plain, [T.placeObject2({ depth: 1, charId: shape, x: 0, y: 0 })]), T.sprite(grid, [T.placeObject2({ depth: 1, charId: shape, x: 0, y: 0 })]), T.defineScalingGrid(grid, im.g))
        exports.push({ id: plain, name: `sl_${key}` }, { id: grid, name: `slg_${key}` })
        ids[key] = { plain, grid, bitmap }
      }
    const code = [AS2_HELPERS]
    casesFor(mode).forEach((k, i) => {
      const im = IMGS[k.img]
      const gl = `[${im.g.x}, ${im.g.y}, ${im.g.w}, ${im.g.h}]`
      const depth = BASE_DEPTH + i
      if (k.method === 'Dn' || k.method === 'D') code.push(`slVector("${k.id}", "${k.method}", ${k.x}, ${k.y}, ${k.w}, ${k.h}, ${gl}, ${depth});`)
      else if (k.method === 'F') {
        // nine bitmap pieces: each is a shape drawing one cell of the bitmap (in source px) and is placed scaled onto its cell of the target
        const gx = [0, im.g.x, im.g.x + im.g.w, im.w], gy = [0, im.g.y, im.g.y + im.g.h, im.h]
        const tx = [0, im.g.x, k.w - (im.w - im.g.x - im.g.w), k.w], ty = [0, im.g.y, k.h - (im.h - im.g.y - im.g.h), k.h]
        for (let r = 0; r < 3; r++)
          for (let q = 0; q < 3; q++) {
            const cw = gx[q + 1]! - gx[q]!, ch = gy[r + 1]! - gy[r]!, sx = (tx[q + 1]! - tx[q]!) / cw, sy = (ty[r + 1]! - ty[r]!) / ch
            const shape = next++
            defs.push(T.defineBitmapShape({ id: shape, bitmapId: ids[k.img]!.bitmap, rect: { x: gx[q]!, y: gy[r]!, w: cw, h: ch }, scale: 1, tx: 0, ty: 0 }))
            places.push(T.placeObject2({ depth: depth + 100 + r * 3 + q, charId: shape, x: k.x + tx[q]! - gx[q]! * sx, y: k.y + ty[r]! - gy[r]! * sy, scale: sx, scaleY: sy }))
          }
      } else if (k.method === 'T') places.push(T.placeObject2({ depth, charId: ids[k.img]!.grid, name: `T_${k.id}`, x: k.x, y: k.y, scale: k.w / im.w, scaleY: k.h / im.h }))
      else if (mode === 'embedded') code.push(`slEmbedded("${k.id}", "${k.method === 'T2' ? 'slg_' : 'sl_'}${k.img}", "${k.method}", ${k.x}, ${k.y}, ${k.w}, ${k.h}, ${gl}, ${depth});`)
      else code.push(`slDds("${k.id}", "${k.urlForm ? k.urlForm.replace('{h}', im.s.hash) : ddsUrl(im.s.hash)}", "${k.method}", ${k.x}, ${k.y}, ${k.w}, ${k.h}, ${gl}, ${depth});`)
    })
    // generate() ends with [..., DoAction, ShowFrame, End]: the new definitions go before the placements, the frame script grows
    const head = g.tags.slice(0, -3), tail = g.tags.slice(-3)
    const script = g.as2.find((f) => f.path === 'frame_1/DoAction.as')
    if (!script) throw new Error('the generated sheet has no frame script to extend')
    return { ...g, tags: [...head, ...defs, ...(exports.length ? [T.exportAssets(exports)] : []), ...places, ...tail], as2: g.as2.map((f) => (f === script ? { ...f, source: f.source + code.join('\n') + '\n' } : f)) }
  }
}
