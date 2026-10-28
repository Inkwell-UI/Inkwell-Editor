import { describe, expect, it } from 'vitest'
import { generate } from './generate'
import { previewDeviceFont } from './text'
import { frame, rectShape, swf, textNode } from './ir.testutil'
import { parseSwf, readEditText, readImportAssets2, readPlace } from './swfReader.testutil'
import { TAG, writeSwf } from './tags'

const gen = (nodes: Parameters<typeof swf>[0], over: Record<string, unknown> = {}) => generate(swf(nodes, over), { modId: 'MyMod' })
const tagsOf = (g: ReturnType<typeof gen>) => parseSwf(writeSwf({ widthPx: 1920, heightPx: 1080, tags: g.tags })).tags

describe('generate preview', () => {
  const nodes = () => [frame('f', ['s', 't']), rectShape('s'), textNode('t', { verticalAlign: 'center' })]
  const game = generate(swf(nodes()), { modId: 'M' })
  const prev = generate(swf(nodes()), { modId: 'M', preview: true })
  const tags = (g: typeof game) => parseSwf(writeSwf({ widthPx: 1920, heightPx: 1080, tags: g.tags })).tags

  it('vertical align: the preview moves a fixed-size field by the free space (Ruffle ignores the GFx property); the game SWF only sets the property', () => {
    const cls = (g: typeof game) => g.as2.find((f) => f.path.endsWith('Layout.as'))!.source
    expect(cls(prev)).toContain('t.verticalAlign = "center";')
    expect(cls(prev)).toContain('var free = 30 - t.textHeight;')
    expect(cls(prev)).toContain('t._y += (free / 2) * Math.cos(r);')
    expect(cls(game)).not.toContain('textHeight')
  })

  it('text uses a device font: no ImportAssets2, no font id, no outlines', () => {
    const t = tags(prev)
    expect(t.some((x) => x.code === TAG.ImportAssets2)).toBe(false)
    expect(readEditText(t.find((x) => x.code === TAG.DefineEditText)!)).toMatchObject({ hasFont: true, hasFontClass: true, fontClass: '_sans', fontId: 0, useOutlines: false, fontHeight: 360 })
    expect(tags(game).some((x) => x.code === TAG.ImportAssets2)).toBe(true) // the game build is unchanged
  })

  it('same content: same size, colour, alignment, layout and placements', () => {
    const [a, b] = [game, prev].map((g) => tags(g))
    const strip = (e: ReturnType<typeof readEditText>) => ({ ...e, id: 0, fontId: 0, fontClass: undefined, hasFontClass: false, useOutlines: false })
    expect(strip(readEditText(b!.find((x) => x.code === TAG.DefineEditText)!))).toEqual(strip(readEditText(a!.find((x) => x.code === TAG.DefineEditText)!)))
    const places = (t: typeof a) => t!.filter((x) => x.code === TAG.PlaceObject2).map(readPlace).map((p) => ({ ...p, charId: 0 })) // ids differ: the preview has no font character
    expect(places(b)).toEqual(places(a))
    expect(prev.stage).toEqual(game.stage)
    expect(prev.gfxTextExtensions).toBe(1)
  })

  it('centre-aligned fixed box and auto-width text: field bounds, alignment and placement equal the game SWF (only the font differs)', () => {
    const ns = () => [
      frame('f', ['c', 'a']),
      textNode('c', { sizing: 'fixed', align: 'center', transform: { x: 40, y: 20, width: 250, height: 60, rotation: 0 } }),
      textNode('a', { sizing: 'autoWidth', align: 'left', transform: { x: 40, y: 100, width: 120, height: 44, rotation: 0 } })
    ]
    const fields = (g: typeof game) => tags(g).filter((x) => x.code === TAG.DefineEditText).map(readEditText)
    const strip = (e: ReturnType<typeof readEditText>) => ({ ...e, id: 0, fontId: 0, fontClass: undefined, hasFontClass: false, useOutlines: false })
    const a = fields(generate(swf(ns()), { modId: 'M' }))
    const b = fields(generate(swf(ns()), { modId: 'M', preview: true, previewFont: () => 'Barlow Condensed Regular' }))
    expect(b.map(strip)).toEqual(a.map(strip))
    expect(a[0]!.layout.align).toBe(2) // centre
    expect(a[1]!.autoSize).toBe(true)
    expect(b.map((e) => e.fontClass)).toEqual(['Barlow Condensed Regular', 'Barlow Condensed Regular'])
  })

  it('shims run first in the frame code; widget mode is ignored (design frame at design size)', () => {
    const p = generate(swf(nodes()), { modId: 'M', preview: true, widget: true })
    const code = p.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source
    expect(code.indexOf('_global.skse')).toBeLessThan(code.indexOf('.apply(this)'))
    expect(code).toContain('_global.Inkwell')
    expect(code).not.toContain('Widget.install')
    expect(p.stage).toEqual({ width: 1920, height: 1080 })
  })

  it('font shim maps aliases to device fonts', () => {
    expect(previewDeviceFont('$ConsoleFont')).toBe('_typewriter')
    expect(previewDeviceFont('$HandwrittenFont')).toBe('_serif')
    expect(previewDeviceFont('$EverywhereBoldFont')).toBe('_sans')
  })
})

describe('generate preview: embedded glyph outlines', () => {
  const ttf = Buffer.from('ttf')
  const bytes = (n: string) => (n === 'Face A' || n === 'Face B' ? ttf : undefined)
  const nodes = () => [
    frame('f', ['a', 'b', 'c', 'd']),
    textNode('a', { content: 'Caf\u00e9\nx' }),
    textNode('b', { content: 'Ab' }),
    textNode('c', { content: 'zz' }, 'Everywhere / Bold / 18'),
    textNode('d', { content: 'dev' }, 'Console / 18')
  ]
  const g = generate(swf(nodes()), { modId: 'M', preview: true, previewFont: (a) => (a === '$EverywhereMediumFont' ? 'Face A' : a === '$EverywhereBoldFont' ? 'Face B' : '_typewriter'), previewFontBytes: bytes })
  const tags = parseSwf(writeSwf({ widthPx: 1920, heightPx: 1080, tags: g.tags })).tags
  const fields = tags.filter((t) => t.code === TAG.DefineEditText).map(readEditText)

  it('text with font bytes references a placeholder DefineFont3 by id with outlines and no device font name', () => {
    const fonts = tags.filter((t) => t.code === TAG.DefineFont3)
    expect(fonts).toHaveLength(2) // one per face, shared by the two Face A fields
    expect(g.embeddedFonts.map((f) => f.name)).toEqual(['Face A', 'Face B'])
    expect(fields[0]).toMatchObject({ hasFont: true, hasFontClass: false, fontClass: undefined, useOutlines: true, fontId: g.embeddedFonts[0]!.charId })
    expect(fields[1]!.fontId).toBe(fields[0]!.fontId)
    expect(fields[2]!.fontId).toBe(g.embeddedFonts[1]!.charId)
    // the font is defined before the first field that uses it
    expect(tags.findIndex((t) => t.code === TAG.DefineFont3)).toBeLessThan(tags.findIndex((t) => t.code === TAG.DefineEditText))
    expect(fonts[0]!.body.readUInt16LE(0)).toBe(g.embeddedFonts[0]!.charId)
  })

  it('a face without font bytes stays a device font', () => {
    expect(fields[3]).toMatchObject({ hasFontClass: true, fontClass: '_typewriter', fontId: 0, useOutlines: false })
  })

  it('subset: printable ASCII plus the characters of the text nodes using the face, no CR/LF, no duplicates', () => {
    const a = g.embeddedFonts[0]!.chars
    expect(a).toContain('A')
    expect(a).toContain('\u00e9')
    expect(a).not.toMatch(/[\r\n]/)
    expect(a.length).toBe(95 + 1) // ASCII + e-acute
    expect(new Set(a).size).toBe(a.length)
    expect(g.embeddedFonts[1]!.chars.length).toBe(95)
  })

  it('the game SWF never embeds (previewFontBytes is preview-only)', () => {
    expect(generate(swf(nodes()), { modId: 'M', previewFontBytes: bytes }).embeddedFonts).toEqual([])
  })
})

describe('generate', () => {
  it('frame + rect + text: tags, ids, names, imports', () => {
    const g = gen([frame('f', ['s', 't']), rectShape('s'), textNode('t')])
    expect(g.lint).toEqual([])
    const tags = tagsOf(g)
    expect(tags.map((t) => t.code)).toEqual([TAG.SetBackgroundColor, TAG.ImportAssets2, TAG.DefineShape3, TAG.DefineEditText, TAG.PlaceObject2, TAG.PlaceObject2, TAG.ShowFrame, TAG.End])
    const imp = readImportAssets2(tags[1]!)
    expect(imp).toEqual({ url: 'gfxfontlib.swf', items: [{ id: 2, name: '$EverywhereMediumFont' }] })
    const text = readEditText(tags[3]!)
    expect(text).toMatchObject({ fontId: 2, hasFontClass: false, useOutlines: true })
    // shape svg is keyed by character id
    expect(g.shapes).toEqual([expect.objectContaining({ charId: 1, nodeId: 's' })])
    expect(g.shapes[0]!.svg).toContain('<path d="M0 0 L200 0 L200 50 L0 50 Z" fill="#ff0000"')
    const [p1, p2] = [readPlace(tags[4]!), readPlace(tags[5]!)]
    expect(p1).toMatchObject({ depth: 1, charId: 1, name: 'rect_s', matrix: { x: 200, y: 400 } })
    // text sits 2px up and left of the node (gutter)
    expect(p2).toMatchObject({ depth: 2, charId: 3, name: 'text_t', matrix: { x: (5 - 2) * 20, y: (6 - 2) * 20 } })
  })

  it('nested frame becomes a sprite placed with an instance name; names are sanitized and deduplicated', () => {
    const inner = frame('f2', ['t'], { name: 'my panel' })
    const g = gen([frame('f', ['f2', 'f3']), inner, frame('f3', [], { name: 'my panel' }), textNode('t')])
    const tags = tagsOf(g)
    expect(tags.filter((t) => t.code === TAG.DefineSprite)).toHaveLength(2)
    const places = tags.filter((t) => t.code === TAG.PlaceObject2).map(readPlace)
    expect(places.map((p) => p.name)).toEqual(['my_panel', 'my_panel_2'])
  })

  it('instanceNames override layer names', () => {
    const g = generate(swf([frame('f', ['t']), textNode('t')]), { modId: 'M', instanceNames: { t: 'title' } })
    expect(readPlace(tagsOf(g).find((t) => t.code === TAG.PlaceObject2)!).name).toBe('title')
  })

  it('AS2 is namespaced, readable, source-mapped and uses try/catch with a string log (no Error class)', () => {
    const t = textNode('9:1', { verticalAlign: 'center', letterSpacing: { unit: 'percent', value: 5 } })
    const g = generate(swf([frame('f', ['9:1']), t], { id: 'hud' }), { modId: 'My Mod' })
    const cls = g.as2.find((f) => f.path === '__Packages/mods/My_Mod/HudLayout.as')!
    expect(cls.source).toContain('class mods.My_Mod.HudLayout {')
    expect(cls.source).toContain('_global.gfxExtensions = true;')
    expect(cls.source).toContain('// node 9:1 "text 9:1"')
    expect(cls.source).toContain('t.verticalAlign = "center";')
    expect(cls.source).toContain('letterSpacing(t, 0.9)')
    expect(cls.source).toContain('try {')
    expect(cls.source).not.toMatch(/\bError\b/)
    expect(g.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source).toContain('mods.My_Mod.HudLayout.apply(this);')
    // the carrier sprite is exported under __Packages
    expect(tagsOf(g).some((x) => x.code === TAG.ExportAssets && x.body.includes('__Packages.mods.My_Mod.HudLayout'))).toBe(true)
  })

  it('no script statements -> no AS2 and no class carrier', () => {
    const g = gen([frame('f', ['t']), textNode('t')])
    expect(g.as2).toEqual([])
    expect(tagsOf(g).some((t) => t.code === TAG.DoAction || t.code === TAG.ExportAssets)).toBe(false)
  })

  describe('lint', () => {
    it('unmapped font -> error, field omitted, rest compiled', () => {
      const g = gen([frame('f', ['t', 's']), textNode('t', {}, 'Comic Sans'), rectShape('s')])
      expect(g.lint).toEqual([expect.objectContaining({ severity: 'error', code: 'font-unmapped', nodeId: 't' })])
      expect(tagsOf(g).some((t) => t.code === TAG.DefineEditText)).toBe(false)
      expect(g.shapes).toHaveLength(1)
    })

    it('inside/outside strokes -> warning, drawn centered', () => {
      const strokes = [
        { fill: { type: 'solid', color: { r: 0, g: 0, b: 1 } }, weight: 4, alignment: 'inside' },
        { fill: { type: 'solid', color: { r: 0, g: 0, b: 1 } }, weight: 2, alignment: 'center' }
      ]
      const g = gen([frame('f', ['s']), rectShape('s', { strokes })])
      expect(g.lint).toEqual([expect.objectContaining({ severity: 'warning', code: 'stroke-alignment-approximated', nodeId: 's' })])
      expect(g.shapes[0]!.svg).toContain('stroke-width="4"')
    })

    it('an image without its asset -> image-missing-asset; compile continues', () => {
      const img = { ...rectShape('i'), type: 'image', asset: 'h', scaleMode: 'fill' } as never
      const g = gen([frame('f', ['i', 's']), img, rectShape('s')])
      expect(g.lint.map((l) => [l.severity, l.code, l.nodeId])).toEqual([['error', 'image-missing-asset', 'i']])
      expect(g.shapes.map((s) => s.nodeId)).toEqual(['s'])
    })

    it('an instance and a component draw like frames: their children are compiled, no unsupported-node', () => {
      const inst = { ...frame('n', ['s']), type: 'instance', component: 'c' } as never
      const comp = { ...frame('m', ['t']), type: 'component', variants: [] } as never
      const g = gen([frame('f', ['n', 'm']), inst, comp, rectShape('s'), rectShape('t')])
      expect(g.lint.filter((l) => l.code === 'unsupported-node')).toEqual([])
      expect(g.shapes.map((s) => s.nodeId).sort()).toEqual(['s', 't'])
    })

    it('blend: PASS_THROUGH and NORMAL (any case, Figma sends upper case) are silent; others warn', () => {
      const g = gen([frame('f', ['a', 'b', 'c']), rectShape('a', { blend: 'PASS_THROUGH' }), rectShape('b', { blend: 'NORMAL' }), rectShape('c', { blend: 'MULTIPLY' })])
      expect(g.lint.map((l) => [l.code, l.nodeId])).toEqual([['blend-ignored', 'c']])
    })

    it('cubic curves -> warning and stay cubic in the SVG', () => {
      const paths = [[{ op: 'M', x: 0, y: 0 }, { op: 'C', x1: 0, y1: 10, x2: 10, y2: 10, x: 20, y: 0 }, { op: 'Z' }]]
      const g = gen([frame('f', ['s']), rectShape('s', { paths })])
      expect(g.lint.map((l) => l.code)).toEqual(['curve-approximated'])
      expect(g.shapes[0]!.svg).toContain('C0 10 10 10 20 0')
    })

    it('missing child, hidden node, invalid root, gradient and image fills', () => {
      const g = gen([frame('f', ['ghost', 'h', 's']), rectShape('h', { visible: false }), rectShape('s', { fills: [{ type: 'image', asset: 'a' }, { type: 'linear', stops: [{ position: 0, color: { r: 0, g: 1, b: 0 } }] }] })])
      expect(g.lint.map((l) => l.code).sort()).toEqual(['fill-gradient-approximated', 'fill-unsupported', 'node-hidden', 'node-missing'])
      const bad = gen([rectShape('r')])
      expect(bad.lint).toEqual([expect.objectContaining({ severity: 'error', code: 'root-invalid' })])
    })
  })
})

describe('layout lint (export gate rules)', () => {
  const codes = (g: ReturnType<typeof gen>, code: string) => g.lint.filter((l) => l.code === code).map((l) => l.nodeId)

  it('node-off-stage: a layer entirely outside the frame warns once per subtree; inside, touching or rotated does not', () => {
    const t = (x: number, y: number, rotation = 0) => ({ transform: { x, y, width: 100, height: 40, rotation } })
    const g = gen([
      frame('f', ['in', 'edge', 'right', 'up', 'rot', 'box']),
      rectShape('in', t(10, 10)), rectShape('edge', t(-99, 0)), rectShape('right', t(1920, 0)), rectShape('up', t(0, -40)), rectShape('rot', t(-500, 0, 45)),
      frame('box', ['inner'], t(1900, 1000)), rectShape('inner', t(30, 0)) // inner is at 1930: off stage through its parent's offset
    ])
    expect(codes(g, 'node-off-stage')).toEqual(['right', 'up', 'inner'])
  })

  it('text-zero-size: a text box with no width or height warns', () => {
    const g = gen([frame('f', ['a', 'b']), textNode('a', { transform: { x: 0, y: 0, width: 0, height: 30, rotation: 0 } }), textNode('b')])
    expect(codes(g, 'text-zero-size')).toEqual(['a'])
  })

  it('instance-name-duplicate: an overlay instance name a sibling already uses warns; layer-name clashes stay silent', () => {
    const g = generate(swf([frame('f', ['a', 'b', 'c']), textNode('a', { name: 'title' }), textNode('b'), textNode('c', { name: 'same' })]), { modId: 'M', instanceNames: { b: 'title' } })
    expect(codes(g, 'instance-name-duplicate')).toEqual(['b'])
    const quiet = gen([frame('f', ['a', 'b']), textNode('a', { name: 'x' }), textNode('b', { name: 'x' })])
    expect(codes(quiet, 'instance-name-duplicate')).toEqual([])
  })
})

describe('generate auto layout (flow)', () => {
  const auto = { mode: 'horizontal', spacing: 10, padding: [1, 2, 3, 4], primaryAlign: 'center', counterAlign: 'end', wrap: false }
  const row = (over: Record<string, unknown> = {}, aSizing = 'autoWidth') => [
    frame('r', ['row']),
    frame('row', ['a', 'b'], { name: 'row', autoLayout: auto, transform: { x: 0, y: 0, width: 300, height: 60, rotation: 0 }, ...over }),
    textNode('a', { name: 'a', sizing: aSizing, transform: { x: 4, y: 10, width: 80, height: 30, rotation: 0 } }),
    textNode('b', { name: 'b', sizing: 'fixed', transform: { x: 94, y: 10, width: 50, height: 30, rotation: 0 } })
  ]
  const code = (g: ReturnType<typeof gen>) => g.as2.find((f) => f.path.endsWith('DoAction.as'))?.source ?? ''
  it('a fixed auto-layout frame with an auto-width text registers its flow; the class is generated once', () => {
    const g = gen(row())
    expect(code(g)).toContain('mods.MyMod.InkwellFlow.attach(this, "row", 300, 60, 0, 0, 0, 10, 1, 2, 3, 4, 1, 2, ["a", "b"], [[80, 30, 1, -2, -2], [50, 30, 0, -2, -2]]);')
    expect(g.as2.filter((f) => f.path.endsWith('InkwellFlow.as'))).toHaveLength(1)
  })
  it('without an auto-width text nothing changes size at run time: no class, no code', () => {
    const g = gen(row({}, 'fixed'))
    expect(g.as2.some((f) => f.path.endsWith('InkwellFlow.as'))).toBe(false)
  })
  it('a frame that wraps is left as designed, with a note', () => {
    const g = gen(row({ autoLayout: { ...auto, wrap: true } }))
    expect(g.as2.some((f) => f.path.endsWith('InkwellFlow.as'))).toBe(false)
    expect(g.lint.map((l) => l.code)).toContain('flow-static')
  })
  it('a frame that hugs its content registers the axes it sizes; the row above it measures it as a hugging frame', () => {
    const ns = [
      frame('r', ['outer']),
      frame('outer', ['row'], { name: 'outer', autoLayout: auto, transform: { x: 0, y: 0, width: 400, height: 60, rotation: 0 } }),
      frame('row', ['a', 'b'], { name: 'row', autoLayout: auto, layout: { h: 'hug', v: 'fixed' }, transform: { x: 0, y: 0, width: 300, height: 60, rotation: 0 } }),
      textNode('a', { name: 'a', sizing: 'autoWidth', transform: { x: 4, y: 10, width: 80, height: 30, rotation: 0 } }),
      textNode('b', { name: 'b', sizing: 'fixed', transform: { x: 94, y: 10, width: 50, height: 30, rotation: 0 } })
    ]
    const c = code(gen(ns))
    expect(c).toContain('attach(this, "outer.row", 300, 60, 1, 0, 0,')
    expect(c).toContain('attach(this, "outer", 400, 60, 0, 0, 0, 10, 1, 2, 3, 4, 1, 2, ["row"], [[300, 60, 2, 0, 0]]);')
  })
  it('data synced before the Spec had these fields keeps the Figma values in extra.figma and still works', () => {
    const g = gen(row({ autoLayout: { mode: 'horizontal', spacing: 10, padding: [1, 2, 3, 4] }, extra: { figma: { primaryAxisAlignItems: 'MAX', counterAxisAlignItems: 'CENTER' } } }))
    expect(code(g)).toContain('1, 2, 3, 4, 2, 1, ["a", "b"]')
  })
})
