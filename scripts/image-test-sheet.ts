// Content of the in-game image test sheet: the SAME images and layout for both image modes (embedded / dds), so the two menus compare 1:1.
import { Swf } from '@inkwell-ui/spec'
import type { ImageMode } from '../src/main/images/assets'
import { syntheticPng } from '../src/main/images/synthetic'

/** Synthetic images (generated, never committed): 64x64, 256x256 and 256x128, all with alpha and powers of two. */
export const IMAGES = { small: syntheticPng(64, 64), square: syntheticPng(256, 256), wide: syntheticPng(256, 128) }

export const SHEETS = [
  { id: 'imagetest', menu: 'InkwellImageTest', mode: 'embedded' as ImageMode, hotkey: 26, key: '[' },
  { id: 'imagetestdds', menu: 'InkwellImageTestDds', mode: 'dds' as ImageMode, hotkey: 27, key: ']' }
] as const

export const MOD_ID = 'ImageTest'

/** 1280x720 custom-menu sheet. Each image sits on a striped bar (alpha shows as stripes through the image) next to a grey box marking its frame. */
export function buildImageSheet(id: string, mode: ImageMode): Swf {
  const nodes: Record<string, unknown> = {}
  const kids: string[] = []
  let n = 1
  const col = (h: string) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 })
  const add = (type: string, name: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown>, parent = '1:1', list = kids): string => {
    const nid = `1:${++n}`
    nodes[nid] = { id: nid, name, parent, children: [], transform: { x, y, width: w, height: h, rotation: 0 }, anchor: { h: 'left', v: 'top' }, visible: true, opacity: 1, type, ...extra }
    list.push(nid)
    return nid
  }
  const rect = (name: string, x: number, y: number, w: number, h: number, c: string, parent?: string, list?: string[]) =>
    add('shape', name, x, y, w, h, { paths: [[{ op: 'M', x: 0, y: 0 }, { op: 'L', x: w, y: 0 }, { op: 'L', x: w, y: h }, { op: 'L', x: 0, y: h }, { op: 'Z' }]], fills: [{ type: 'solid', color: col(c) }], strokes: [] }, parent, list)
  const text = (name: string, x: number, y: number, content: string, size = 14, color = '#ffffff', font = '$EverywhereFont', parent?: string, list?: string[]) =>
    add('text', name, x, y, Math.ceil(content.length * size * 0.6), Math.ceil(size * 1.3), {
      content, sizing: 'autoWidth', align: 'left', verticalAlign: 'top', lineHeight: { unit: 'auto' }, letterSpacing: { unit: 'px', value: 0 }, textFit: 'none', truncate: false,
      runs: [{ start: 0, end: content.length, font: { kind: 'alias', name: font }, size, fill: { type: 'solid', color: col(color) } }]
    }, parent, list)
  /** Stripes behind the image box so transparency is visible, and a 2 px grey outline just outside the box (its exact frame). */
  const backdrop = (x: number, y: number, w: number, h: number) => {
    for (let i = 0; i < 8; i++) rect(`stripe ${i}`, x - 10, y + (i * (h + 20)) / 8 - 10, w + 20, (h + 20) / 16, '#d8d8d8')
    for (const [bx, by, bw, bh] of [[x - 2, y - 2, w + 4, 2], [x - 2, y + h, w + 4, 2], [x - 2, y, 2, h], [x + w, y, 2, h]] as const) rect('frame', bx, by, bw, bh, '#8a90a0')
  }
  const image = (name: string, x: number, y: number, w: number, h: number, hash: string, scaleMode: string, extra: Record<string, unknown> = {}) =>
    add('image', name, x, y, w, h, { asset: hash, scaleMode, ...extra })

  rect('background', 0, 0, 1280, 720, '#14161c')
  text('title', 20, 10, `INKWELL IMAGE TEST - ${mode === 'dds' ? 'DDS MODE (img://textures/Inkwell/ImageTest/<hash>.dds)' : 'EMBEDDED MODE (bitmaps inside the SWF)'}`, 20, '#ffd24a', '$EverywhereBoldFont')
  text('legend', 20, 40, 'Every image: 1px yellow border, black triangle in the TOP-LEFT corner, red/green top, blue/white bottom, transparent to the LEFT (stripes show through).', 12, '#aab0bc')
  text('legend2', 20, 56, 'Grey outline = the image frame. Blank where an image should be = this mode does not work in game; please report which items show.', 12, '#aab0bc')

  const { small, square, wide } = IMAGES
  const items: [string, number, number, number, number, string, string, string, Record<string, unknown>?][] = [
    ['A 64x64 at 1:1 (FILL)', 30, 110, 64, 64, small.hash, 'fill', 'A  64x64 image, 64x64 box: exact size'],
    ['B 64x64 scaled to 128 (FILL)', 170, 110, 128, 128, small.hash, 'fill', 'B  same image scaled up 2x'],
    ['C 256x256 at 1:1 (FILL)', 360, 110, 256, 256, square.hash, 'fill', 'C  256x256 image at 1:1'],
    ['D 256x128 FIT in 200x200', 680, 110, 200, 200, wide.hash, 'fit', 'D  FIT: whole image, empty bands above/below'],
    ['E 256x128 FILL in 200x200', 940, 110, 200, 200, wide.hash, 'fill', 'E  FILL: fills the box, left/right cut off'],
    ['F 256x256 at 50% opacity', 30, 430, 160, 160, square.hash, 'fill', 'F  50% opacity (paint), dimmer than C', { fillOpacity: 0.5 }],
    ['G 256x128 rotated 30', 260, 520, 200, 100, wide.hash, 'fit', 'G  rotated 30 deg about its top-left corner, rises to the right']
  ]
  for (const [name, x, y, w, h, hash, mode2, caption, extra] of items) {
    backdrop(x, y, w, h)
    const id2 = image(name, x, y, w, h, hash, mode2, extra)
    if (name.startsWith('G')) (nodes[id2] as { transform: { rotation: number } }).transform.rotation = 30 // Figma counterclockwise
    text(`caption ${name}`, x - 10, y + h + 18, caption, 12, '#ffffff')
  }
  // H: a frame whose background is an image fill, with text and a shape on top (the fill is a clip under the children)
  const hk: string[] = []
  backdrop(560, 430, 256, 160)
  const h = add('frame', 'H frame with image fill', 560, 430, 256, 160, { clipContent: false, fills: [{ type: 'image', asset: square.hash, scaleMode: 'fill' }] })
  ;(nodes[h] as { children: string[] }).children = hk
  rect('H bar', 0, 120, 256, 40, '#14161c', h, hk)
  text('H label', 8, 128, 'Text over a frame image fill', 16, '#ffffff', '$EverywhereFont', h, hk)
  text('caption H', 550, 608, 'H  frame image fill under its children', 12)

  return Swf.parse({
    specVersion: 4, id, name: id, target: { kind: 'customMenu' }, stage: { width: 1280, height: 720 }, root: '1:1',
    nodes: { '1:1': { id: '1:1', name: 'root', parent: null, children: kids, transform: { x: 0, y: 0, width: 1280, height: 720, rotation: 0 }, anchor: { h: 'left', v: 'top' }, visible: true, opacity: 1, type: 'frame', clipContent: false }, ...nodes }
  })
}
