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

    it('image/instance/component nodes -> unsupported-node warning, compile continues', () => {
      const img = { ...rectShape('i'), type: 'image', asset: 'h', scaleMode: 'fill' } as never
      const inst = { ...rectShape('n'), type: 'instance', component: 'c' } as never
      const g = gen([frame('f', ['i', 'n', 's']), img, inst, rectShape('s')])
      expect(g.lint.map((l) => [l.severity, l.code, l.nodeId])).toEqual([['warning', 'unsupported-node', 'i'], ['warning', 'unsupported-node', 'n']])
      expect(g.shapes.map((s) => s.nodeId)).toEqual(['s'])
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
