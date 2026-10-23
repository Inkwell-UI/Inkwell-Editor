// Content generator for the in-game compiler test sheet: one layout in 1920x1080 units, scaled to the stage by `k`.
import { Swf } from '@inkwell-ui/spec'

type Rgb = { r: number; g: number; b: number }
const hex = (h: string): Rgb => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 })
const C = { bg: '#14161c', white: '#ffffff', grey: '#aab0bc', head: '#ffd24a', red: '#e03a3a', yellow: '#ffe14a', bar: '#f2f2f2', cyan: '#27c7d9', magenta: '#e040c0', orange: '#ff8a1f', green: '#3fbf5f', ref: '#4a4f5c', b1: '#2b4a7a', b2: '#2e6b4f', b3: '#6b2e5e', b4: '#7a5a2b' }

export const PARAGRAPH = 'The quick brown fox jumps over the lazy dog while the five boxing wizards jump quickly. Pack my box with five dozen liquor jugs.'
export const LONG = 'This long sentence has to be made smaller to fit the little box.'

/** Builds the sheet IR for a stage; every length (position, size, font size, stroke) goes through `k = width / 1920`. */
export function buildSheet(id: string, name: string, width: number, height: number): Swf {
  const k = width / 1920
  const s = (v: number): number => Math.round(v * k * 100) / 100
  const nodes: Record<string, unknown> = {}
  const rootKids: string[] = []
  let n = 0
  const add = (type: string, nm: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown>, rotation = 0): void => {
    const nid = `1:${++n + 1}`
    nodes[nid] = { id: nid, name: nm, parent: '1:1', children: [], transform: { x: s(x), y: s(y), width: s(w), height: s(h), rotation }, anchor: { h: 'left', v: 'top' }, visible: true, opacity: 1, type, ...extra }
    rootKids.push(nid)
  }
  const solid = (c: string, opacity?: number) => ({ type: 'solid', color: hex(c), ...(opacity === undefined ? {} : { opacity }) })
  const shape = (nm: string, x: number, y: number, w: number, h: number, fill: string, paths: unknown[][], extra: Record<string, unknown> = {}, rotation = 0) =>
    add('shape', nm, x, y, w, h, { paths: paths.map((p) => (p as { x?: number; y?: number }[]).map((c) => scalePt(c))), fills: [solid(fill, (extra['alpha'] as number | undefined))], strokes: extra['strokes'] ?? [] }, rotation)
  const scalePt = (c: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(c).map(([key, v]) => [key, typeof v === 'number' ? s(v) : v]))
  const rectPath = (w: number, h: number): unknown[] => [{ op: 'M', x: 0, y: 0 }, { op: 'L', x: w, y: 0 }, { op: 'L', x: w, y: h }, { op: 'L', x: 0, y: h }, { op: 'Z' }]
  const rect = (nm: string, x: number, y: number, w: number, h: number, fill: string, extra: Record<string, unknown> = {}, rotation = 0) => shape(nm, x, y, w, h, fill, [rectPath(w, h)], extra, rotation)

  type TextOpts = { font?: string; size?: number; color?: string; sizing?: 'fixed' | 'autoWidth' | 'autoHeight'; w?: number; h?: number; align?: string; v?: string; lh?: unknown; ls?: unknown; fit?: string }
  const text = (nm: string, x: number, y: number, content: string, o: TextOpts = {}): void => {
    const size = o.size ?? 18
    const w = o.w ?? Math.ceil(content.length * size * 0.6)
    add('text', nm, x, y, w, o.h ?? Math.ceil(size * 1.25), {
      content, sizing: o.sizing ?? 'autoWidth', align: o.align ?? 'left', verticalAlign: o.v ?? 'top', lineHeight: o.lh ?? { unit: 'auto' }, letterSpacing: o.ls ?? { unit: 'px', value: 0 }, textFit: o.fit ?? 'none', truncate: false,
      runs: [{ start: 0, end: content.length, font: { kind: 'alias', name: o.font ?? '$EverywhereFont' }, size: s(size), fill: solid(o.color ?? C.white) }]
    })
  }
  const head = (x: number, y: number, t: string): void => text('H ' + t.slice(0, 1), x, y, t, { font: '$EverywhereBoldFont', size: 18, color: C.head })
  const label = (x: number, y: number, t: string): void => text('label', x, y, t, { size: 12, color: C.grey })

  rect('background', 0, 0, 1920, 1080, C.bg)
  text('title', 30, 8, `INKWELL COMPILER TEST SHEET - ${name} (${width}x${height}) - compare each item with its caption`, { font: '$EverywhereBoldFont', size: 24 })

  // Column 1 (x=30): shapes, rotation, fonts
  head(30, 50, 'A  panel: 50% red fill + 3px centred yellow stroke over a white bar (bar must show through the fill)')
  rect('bar', 130, 84, 150, 90, C.bar)
  rect('panel', 30, 80, 200, 100, C.red, { alpha: 0.5, strokes: [{ fill: solid(C.yellow), weight: s(3), alignment: 'center' }] })
  head(30, 200, 'B  cyan ellipse | magenta curved leaf | orange triangle')
  const kx = 0.5523
  const ell = (w: number, h: number): unknown[] => [{ op: 'M', x: w / 2, y: 0 }, { op: 'C', x1: w / 2 + (w / 2) * kx, y1: 0, x2: w, y2: h / 2 - (h / 2) * kx, x: w, y: h / 2 }, { op: 'C', x1: w, y1: h / 2 + (h / 2) * kx, x2: w / 2 + (w / 2) * kx, y2: h, x: w / 2, y: h }, { op: 'C', x1: w / 2 - (w / 2) * kx, y1: h, x2: 0, y2: h / 2 + (h / 2) * kx, x: 0, y: h / 2 }, { op: 'C', x1: 0, y1: h / 2 - (h / 2) * kx, x2: w / 2 - (w / 2) * kx, y2: 0, x: w / 2, y: 0 }, { op: 'Z' }]
  shape('ellipse', 30, 230, 100, 70, C.cyan, [ell(100, 70)])
  shape('leaf', 160, 230, 120, 70, C.magenta, [[{ op: 'M', x: 0, y: 70 }, { op: 'C', x1: 10, y1: 0, x2: 80, y2: 0, x: 120, y: 0 }, { op: 'C', x1: 110, y1: 70, x2: 40, y2: 70, x: 0, y: 70 }, { op: 'Z' }]])
  shape('triangle', 310, 230, 100, 70, C.orange, [[{ op: 'M', x: 50, y: 0 }, { op: 'L', x: 100, y: 70 }, { op: 'L', x: 0, y: 70 }, { op: 'Z' }]])
  head(30, 320, 'C  green rect rotated 30 deg (Figma counterclockwise): expected to lean UP to the right')
  label(30, 342, 'grey rect = same box unrotated, same top-left corner. Green rises to the right = correct; green falls to the right = sign wrong.')
  rect('unrotated reference', 60, 450, 160, 60, C.ref)
  rect('rotated 30', 60, 450, 160, 60, C.green, {}, 30)
  head(30, 540, 'D  one row per font alias (small label, then the size 24 sample)')
  const fonts = ['$EverywhereFont', '$EverywhereMediumFont', '$EverywhereBoldFont', '$ConsoleFont', '$DialogueFont', '$HandwrittenFont', '$DragonFont']
  fonts.forEach((f, i) => { label(30, 566 + i * 48, f); text('sample ' + f, 30, 582 + i * 48, 'Sphinx of black quartz 123', { font: f, size: 24 }) })
  label(30, 908, '$EverywhereFont at 12 / 18 / 36')
  text('size 12', 30, 926, 'Size 12', { size: 12 })
  text('size 18', 110, 926, 'Size 18', { size: 18 })
  text('size 36', 220, 926, 'Size 36', { size: 36 })

  // Column 2 (x=500): alignment, sizing, line height
  head(500, 50, 'E  align left | center | right in 400px boxes')
  ;(['left', 'center', 'right'] as const).forEach((a, i) => {
    rect('box ' + a, 500, 80 + i * 50, 400, 40, [C.b1, C.b2, C.b3][i]!)
    text('align ' + a, 500, 80 + i * 50, `Aligned ${a}`, { size: 24, sizing: 'fixed', w: 400, h: 40, align: a, v: 'center' })
  })
  head(500, 240, 'F  autoWidth (one line) | autoHeight (wraps in 300px) | fixed 300x40 (wraps, cut off)')
  label(500, 266, 'autoWidth'); text('f autoWidth', 500, 282, 'Auto width stays on one line', { size: 18 })
  label(500, 316, 'autoHeight: 300px wide, about 4 lines, box grows (blue rect is the 300x90 estimate)')
  rect('f box', 500, 332, 300, 90, C.b1)
  text('f autoHeight', 500, 332, PARAGRAPH, { size: 18, sizing: 'autoHeight', w: 300, h: 90 })
  label(500, 436, 'fixed 300x40: only about two lines fit (green rect is the field)')
  rect('f fixed box', 500, 452, 300, 40, C.b2)
  text('f fixed', 500, 452, PARAGRAPH, { size: 18, sizing: 'fixed', w: 300, h: 40 })
  head(500, 520, 'G  line height: auto | 150% (same paragraph; 150% is visibly looser)')
  label(500, 546, 'auto'); text('g auto', 500, 562, PARAGRAPH, { size: 18, sizing: 'autoHeight', w: 300, h: 90 })
  label(500, 670, '150%'); text('g 150', 500, 686, PARAGRAPH, { size: 18, sizing: 'autoHeight', w: 300, h: 110, lh: { unit: 'percent', value: 150 } })

  // Column 3 (x=970): letter spacing, vertical align, text fit
  head(970, 50, 'H  letter spacing 0 | 10% | 30% (each wider than the one above)')
  ;[0, 10, 30].forEach((p, i) => { label(970, 76 + i * 56, `${p}%`); text('ls ' + p, 970, 92 + i * 56, 'Spacing WAVE 123', { size: 24, ls: { unit: 'percent', value: p } }) })
  head(970, 260, 'I  vertical align top | center | bottom in 150px tall boxes')
  ;(['top', 'center', 'bottom'] as const).forEach((v, i) => {
    rect('v box ' + v, 970 + i * 150, 290, 130, 150, [C.b1, C.b2, C.b3][i]!)
    text('v ' + v, 970 + i * 150, 290, v, { size: 24, sizing: 'fixed', w: 130, h: 150, v, align: 'center' })
  })
  head(970, 470, 'J  textFit none (overflows/cut) | shrink | fit, long text in 200x60 boxes (shrink and fit: whole text visible, smaller)')
  ;(['none', 'shrink', 'fit'] as const).forEach((f, i) => {
    rect('fit box ' + f, 970 + i * 220, 500, 200, 60, C.b4)
    text('fit ' + f, 970 + i * 220, 500, LONG, { size: 24, sizing: 'fixed', w: 200, h: 60, fit: f })
  })

  const ids = Object.keys(nodes)
  const ir = {
    specVersion: 3, id, name, target: { kind: 'hudWidget' }, stage: { width, height }, root: '1:1',
    nodes: {
      '1:1': { id: '1:1', name: 'root', parent: null, children: ids, transform: { x: 0, y: 0, width, height, rotation: 0 }, anchor: { h: 'left', v: 'top' }, visible: true, opacity: 1, type: 'frame', clipContent: false },
      ...nodes
    }
  }
  return Swf.parse(ir)
}

export const VARIANTS = [
  { id: 'ingametest', name: 'Ingame Test', width: 1920, height: 1080 },
  { id: 'ingametest720', name: 'Ingame Test 720', width: 1280, height: 720 }
] as const
