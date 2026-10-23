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
})

import { writeSwf } from '../swf/tags'
function buildFile(tags: Buffer[]): Buffer {
  return writeSwf({ widthPx: 1280, heightPx: 720, tags })
}
