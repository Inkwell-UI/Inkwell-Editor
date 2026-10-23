import { describe, expect, it } from 'vitest'
import { generate } from './generate'
import { parseSwf, readEditText, readImportAssets2 } from './swfReader.testutil'
import { TAG, writeSwf } from './tags'
import { buildSheet, VARIANTS } from '../../../scripts/ingame-test-sheet'

describe('ingame test sheet', () => {
  it.each(VARIANTS)('$id validates and compiles without lint errors', (v) => {
    const g = generate(buildSheet(v.id, v.name, v.width, v.height), { modId: 'IngameTest' })
    expect(g.lint.filter((l) => l.severity === 'error')).toEqual([])
  })

  it.each(VARIANTS)('$id imports every font like vanilla: one ImportAssets2 per alias, before the fields that use it', (v) => {
    const g = generate(buildSheet(v.id, v.name, v.width, v.height), { modId: 'IngameTest' })
    const imported = new Map<number, string>()
    let fields = 0
    for (const t of parseSwf(writeSwf({ widthPx: v.width, heightPx: v.height, tags: g.tags })).tags) {
      if (t.code === TAG.ImportAssets2) {
        const imp = readImportAssets2(t)
        expect(imp.url).toBe('gfxfontlib.swf')
        expect(imp.items).toHaveLength(1) // several assets in one tag: only the first resolved in game
        imported.set(imp.items[0]!.id, imp.items[0]!.name)
      } else if (t.code === TAG.DefineEditText) {
        fields++
        expect(imported.has(readEditText(t).fontId!)).toBe(true)
      }
    }
    expect(fields).toBeGreaterThan(50)
    expect(new Set(imported.values()).size).toBe(7) // every alias row of section D
  })

  it.each(VARIANTS)('$id has the section K rows: text in groups rotated 30 / 90 deg, at 50% opacity, and with 50% fill alpha', (v) => {
    const ir = buildSheet(v.id, v.name, v.width, v.height)
    const groups = Object.values(ir.nodes).filter((n) => n.type === 'frame' && n.id !== ir.root)
    const withText = (g: (typeof groups)[number]) => g.type === 'frame' && g.children.some((c) => ir.nodes[c]?.type === 'text')
    expect(groups.filter(withText).map((g) => [g.transform.rotation, g.opacity]).sort()).toEqual([[0, 0.5], [0, 1], [30, 1], [90, 1]].sort())
    const g = generate(ir, { modId: 'IngameTest' })
    expect(g.lint.filter((l) => l.severity === 'error')).toEqual([])
    const fields = parseSwf(writeSwf({ widthPx: v.width, heightPx: v.height, tags: g.tags })).tags.filter((t) => t.code === TAG.DefineEditText).map(readEditText)
    expect(fields.filter((f) => f.color.a === 128 && f.text === 'Alpha 50%')).toHaveLength(1) // the game SWF keeps the text fill alpha
  })
})
