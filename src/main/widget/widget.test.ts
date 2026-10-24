import { describe, expect, it } from 'vitest'
import { generate } from '../swf/generate'
import { frame, rectShape, swf, textNode } from '../swf/ir.testutil'
import { parseSwf, readImportAssets2 } from '../swf/swfReader.testutil'
import { TAG } from '../swf/tags'
import { widgetPlacement } from './frame'
import { CONTRACT_METHODS } from './widgetAs2'

// root (stage) > Hud (right/top, at 1500,40, 380x120) > panel + two texts in different fonts
const ir = () =>
  swf(
    [
      frame('root', ['hud']),
      frame('hud', ['p', 't1', 't2'], { name: 'Hud', transform: { x: 1500, y: 40, width: 380, height: 120, rotation: 0 }, anchor: { h: 'right', v: 'top' }, opacity: 0.5 }),
      rectShape('p'),
      textNode('t1', {}, 'Everywhere / Medium / 24'),
      textNode('t2', {}, 'Everywhere / Bold / 18')
    ],
    { id: 'hud', name: 'Test Widget' }
  )

const gen = () => generate(ir(), { modId: 'WidgetMod', widget: true })

describe('widget SWF (generate with widget: true)', () => {
  it('puts the frame content in a root clip named "widget", scaled 2/3, on a 1280x720 stage', () => {
    const g = gen()
    expect(g.stage).toEqual({ width: 1280, height: 720 })
    const tags = parseSwf(Buffer.concat([Buffer.alloc(0)]).length ? Buffer.alloc(0) : buildFile(g.tags)).tags
    const place = tags.filter((t) => t.code === TAG.PlaceObject2)
    expect(place).toHaveLength(1) // only the widget clip on the main timeline
    const b = place[0]!.body
    expect(b[0]! & 0x20).toBe(0x20) // has name
    expect(b.toString('latin1')).toContain('widget')
    // matrix right after flags(1) depth(2) charId(2): HasScale=1, 5-bit n, scaleX as signed 16.16
    const bits = [...b.subarray(5, 12)].map((v) => v.toString(2).padStart(8, '0')).join('')
    expect(bits[0]).toBe('1')
    const n = parseInt(bits.slice(1, 6), 2)
    const raw = parseInt(bits.slice(6, 6 + n), 2)
    expect(raw / 65536).toBeCloseTo(2 / 3, 4)
    // the widget frame's own position is not baked into the SWF
    expect(g.lint.filter((l) => l.severity === 'error')).toEqual([])
  })

  it('has one ImportAssets2 tag per font and an AS2 contract class installed on the clip', () => {
    const g = gen()
    const tags = parseSwf(buildFile(g.tags)).tags
    const imports = tags.filter((t) => t.code === TAG.ImportAssets2).map(readImportAssets2)
    expect(imports.map((i) => i.items.map((x) => x.name))).toEqual([['$EverywhereMediumFont'], ['$EverywhereBoldFont']])
    const cls = g.as2.find((f) => f.path === '__Packages/mods/WidgetMod/HudWidget.as')!.source
    expect(cls).toContain('class mods.WidgetMod.HudWidget {')
    for (const m of CONTRACT_METHODS) expect(cls).toContain(`w.${m} = function`)
    expect(cls).not.toMatch(/\bError\b/)
    const frame1 = g.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source
    expect(frame1).toContain('mods.WidgetMod.HudWidget.install(widget);')
    expect(tags.some((t) => t.code === TAG.DoAction)).toBe(true)
  })

  it('warns about other top-level layers and leaves normal output alone without the flag', () => {
    const extra = swf([frame('root', ['hud', 'other']), frame('hud', []), rectShape('other')])
    expect(generate(extra, { modId: 'M', widget: true }).lint.map((l) => l.code)).toEqual(['widget-extra-content'])
    const plain = generate(ir(), { modId: 'M' })
    expect(plain.as2.some((f) => f.path.endsWith('Widget.as'))).toBe(false)
    expect(plain.stage).toEqual({ width: 1920, height: 1080 })
  })
})

describe('widgetPlacement', () => {
  it('maps the anchor point of the first frame to 1280x720 HUD space', () => {
    expect(widgetPlacement(ir())).toEqual({ hAnchor: 'right', vAnchor: 'top', x: 1253.333, y: 26.667, alpha: 50 })
  })
  it('an overlay anchor ignores the Figma position: screen edge moved inward by the margin (design px x 2/3)', () => {
    expect(widgetPlacement(ir(), { h: 'right', v: 'top', x: 24, y: 24 })).toEqual({ hAnchor: 'right', vAnchor: 'top', x: 1264, y: 16, alpha: 50 })
    expect(widgetPlacement(ir(), { h: 'left', v: 'bottom', x: 30, y: 60 })).toMatchObject({ x: 20, y: 680 })
    expect(widgetPlacement(ir(), { h: 'center', v: 'center', x: -30, y: 0 })).toMatchObject({ hAnchor: 'center', vAnchor: 'center', x: 620, y: 360 })
  })
})

describe('settable texts (popup)', () => {
  const popup = (opts: Partial<Parameters<typeof generate>[1]> = {}) =>
    generate(ir(), { modId: 'WidgetMod', widget: true, settableTexts: new Set(['t1', 't2']), instanceNames: { t1: 'title', t2: 'description' }, ...opts })
  it('lists the compiled fields in layer order with paths relative to the widget clip', () => {
    expect(popup().settableTexts).toEqual([
      { nodeId: 't1', layer: 'text t1', name: 'title', path: 'title' },
      { nodeId: 't2', layer: 'text t2', name: 'description', path: 'description' }
    ])
  })
  it('gives the widget clip setTexts/show/hide, starts hidden, fades through setAlpha; no Error, no filters', () => {
    const cls = popup().as2.find((f) => f.path.endsWith('HudWidget.as'))!.source
    for (const m of ['setTexts', 'show', 'hide', 'tick', 'applyFade']) expect(cls).toContain(`w.${m} = function`)
    expect(cls).toContain('w.setTexts = function (a0, a1) {')
    expect(cls).toContain('this.title.text = a0 == undefined ? "" : String(a0);')
    expect(cls).toContain('// node t2 "text t2"')
    expect(cls).toContain('w._visible = false;')
    expect(cls).toContain('w.setAlpha = function (a) { this._baseAlpha = a; this.applyFade(); };')
    expect(cls).toContain('w.initText(w.description, "t2");')
    expect(cls).not.toMatch(/\bError\b|flash\.filters/)
    expect(cls).toMatchSnapshot()
  })
  it('a static widget is unchanged (no popup code)', () => {
    const g = generate(ir(), { modId: 'WidgetMod', widget: true })
    expect(g.settableTexts).toEqual([])
    expect(g.as2.find((f) => f.path.endsWith('HudWidget.as'))!.source).not.toContain('setTexts')
  })
  it('names that clash ignoring case are an error (Papyrus parameters are case-insensitive)', () => {
    const g = popup({ instanceNames: { t1: 'Title', t2: 'title' } })
    expect(g.lint.filter((l) => l.code === 'widget-text-name-clash').map((l) => l.nodeId)).toEqual(['t2'])
    expect(g.settableTexts.map((t) => t.name)).toEqual(['Title'])
  })
})

import { writeSwf } from '../swf/tags'
function buildFile(tags: Buffer[]): Buffer {
  return writeSwf({ widthPx: 1280, heightPx: 720, tags })
}

// Runs the generated contract's own JS-compatible AS2 (install body) against a fake clip and SkyUI's HUD metrics.
// SkyUI's WidgetLoader puts hMin/vMin = the safe-rect origin and hMax/vMax = the far safe edge (HUD-local), and the
// widget container sits at that origin; s = 16.5 x 17 HUD px reproduces the owner's 1920x1080 screenshot of the old build.
describe('contract placement on screen (simulated SkyUI)', () => {
  const S = { x: 16.5, y: 17 }
  const metrics = { hMin: S.x, hMax: 1280 - S.x, vMin: S.y, vMax: 720 - S.y }
  const W = 274 // 411 design px x 2/3
  const H = 133.333
  const screenBox = (cls: string, p: { hAnchor: string; vAnchor: string; x: number; y: number }) => {
    const body = cls.slice(cls.indexOf('static function install(w) {') + 'static function install(w) {'.length, cls.lastIndexOf('    }\n}'))
    const w: Record<string, any> = { _width: W, _height: H, _parent: { _x: 0, _y: 0 } }
    new Function('w', '_global', body)(w, {})
    w.setHudMetrics(metrics)
    w.setHAnchor(p.hAnchor)
    w.setVAnchor(p.vAnchor)
    w.setPositionX(p.x)
    w.setPositionY(p.y)
    const left = S.x + w._parent._x + w._x
    const top = S.y + w._parent._y + w._y
    return { left, top, right: left + W, bottom: top + H }
  }
  const cls = generate(ir(), { modId: 'WidgetMod', widget: true }).as2.find((f) => f.path.endsWith('HudWidget.as'))!.source

  it('reproduces the measured bug with the old (swapped) lerp: left ~1023, top ~50', () => {
    const old = cls.replace('return a + (v - c) / (d - c) * (b - a);', 'return c + (d - c) * (v - a) / (b - a);')
    const b = screenBox(old, { hAnchor: 'right', vAnchor: 'top', x: 1264, y: 16 })
    expect(b.left).toBeCloseTo(1023, 0)
    expect(b.top).toBeCloseTo(50, 0)
  })
  it('top right with 24/24 design px margins: right edge 1264, top 16 (screen 1485..1896 x 24..224 at 1920x1080)', () => {
    const b = screenBox(cls, widgetPlacement(ir(), { h: 'right', v: 'top', x: 24, y: 24 })!)
    expect(b.right).toBeCloseTo(1264, 3)
    expect(b.left).toBeCloseTo(990, 3)
    expect(b.top).toBeCloseTo(16, 3)
  })
  it('every anchor puts the anchored edges on the margins', () => {
    for (const h of ['left', 'center', 'right'] as const)
      for (const v of ['top', 'center', 'bottom'] as const) {
        const b = screenBox(cls, widgetPlacement(ir(), { h, v, x: 24, y: 24 })!)
        const cx = (b.left + b.right) / 2
        const cy = (b.top + b.bottom) / 2
        if (h === 'left') expect(b.left).toBeCloseTo(16, 3)
        if (h === 'right') expect(b.right).toBeCloseTo(1264, 3)
        if (h === 'center') expect(cx).toBeCloseTo(656, 3)
        if (v === 'top') expect(b.top).toBeCloseTo(16, 3)
        if (v === 'bottom') expect(b.bottom).toBeCloseTo(704, 3)
        if (v === 'center') expect(cy).toBeCloseTo(376, 3)
      }
  })
})
