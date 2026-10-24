import { describe, expect, it } from 'vitest'
import { textNode } from './ir.testutil'
import type { Node } from '@inkwell-ui/spec'
import { describeTextMapping, fallbackAlias, fontAlias, mapText, NATURAL_LINE_HEIGHT } from './text'

type TextNode = Parameters<typeof mapText>[0]
const map = (over: Record<string, unknown> = {}, font?: string) => mapText(textNode('t', over, font) as TextNode)

describe('font alias mapping', () => {
  it.each([
    ['Everywhere / Medium / 18', '$EverywhereMediumFont'],
    ['Everywhere / Bold', '$EverywhereBoldFont'],
    ['Everywhere/24', '$EverywhereFont'],
    ['Start Menu / 30', '$StartMenuFont'],
    ['$DragonFont', '$DragonFont'],
    ['Everywhere/Light', '$EverywhereFont'],
    ['Dragon/Regular', '$DragonFont'],
    ['Handwritten/Regular', '$HandwrittenFont'],
    ['SkyrimSymbols/Regular', '$SkyrimSymbolsFont'],
    ['SkyrimBooks/Regular', '$SkyrimBooks'],
    ['SkyrimBooks', '$SkyrimBooks'],
    ['$SkyrimBooks', '$SkyrimBooks'],
    ['$SkyrimBooksFont', undefined],
    ['SkyrimBooks/Bold', undefined],
    ['Futura', undefined],
    ['Everywhere / Black / 18', undefined],
    ['$NopeFont', undefined],
    ['', undefined]
  ])('%s -> %s', (name, alias) => expect(fontAlias(name)).toBe(alias))
})

describe('text mapping table', () => {
  it('fixed: fixed field, wraps, no autoSize; gutter grows the box by 2px per side and moves it back', () => {
    const { text, lint } = map()
    expect(lint).toEqual([])
    expect(text).toMatchObject({
      alias: '$EverywhereMediumFont', gutter: { x: -2, y: -2 },
      field: { wPx: 124, hPx: 34, sizePx: 18, wordWrap: true, multiline: true, autoSize: false, align: 0, leadingPx: 0, color: { r: 255, g: 128, b: 0, a: 255 } }
    })
  })

  it('auto width: autoSize, no wrap, single line unless content has breaks', () => {
    expect(map({ sizing: 'autoWidth' }).text?.field).toMatchObject({ autoSize: true, wordWrap: false, multiline: false })
    expect(map({ sizing: 'autoWidth', content: 'a\nb' }).text?.field).toMatchObject({ autoSize: true, wordWrap: false, multiline: true, text: 'a\rb' })
  })

  it('auto height: wordWrap + multiline + autoSize', () => {
    expect(map({ sizing: 'autoHeight' }).text?.field).toMatchObject({ autoSize: true, wordWrap: true, multiline: true })
  })

  it('alignment, line height -> leading, letter spacing % -> px', () => {
    const r = map({ align: 'right', lineHeight: { unit: 'px', value: 30 }, letterSpacing: { unit: 'percent', value: 10 } }).text!
    expect(r.field.align).toBe(1)
    expect(r.field.leadingPx).toBeCloseTo(30 - 18 * NATURAL_LINE_HEIGHT)
    expect(r.script.letterSpacing).toBeCloseTo(1.8)
  })

  it('percent line height and px letter spacing', () => {
    const r = map({ lineHeight: { unit: 'percent', value: 150 }, letterSpacing: { unit: 'px', value: 3 } }).text!
    expect(r.field.leadingPx).toBeCloseTo(27 - 18 * NATURAL_LINE_HEIGHT)
    expect(r.script.letterSpacing).toBe(3)
  })

  it('vertical align (not top) and shrink go to the frame script', () => {
    expect(map({ verticalAlign: 'center', textFit: 'shrink' }).text?.script).toEqual({ verticalAlign: 'center', textAutoSize: 'shrink' })
    expect(map({ verticalAlign: 'top' }).text?.script).toEqual({})
  })

  it('opacity of the fill goes into the colour alpha', () => {
    const runs = [{ start: 0, end: 5, font: { kind: 'alias', name: 'Everywhere' }, size: 12, fill: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 0.5 }, opacity: 0.5 } }]
    expect(map({ runs }).text?.field.color.a).toBe(64)
  })

  it('unmapped font is an ERROR and produces no field', () => {
    const r = map({}, 'Comic Sans')
    expect(r.text).toBeUndefined()
    expect(r.lint).toEqual([expect.objectContaining({ severity: 'error', code: 'font-unmapped', nodeId: 't' })])
  })

  it('embedded font is an error; truncate is a warning', () => {
    const runs = [{ start: 0, end: 5, font: { kind: 'embedded', asset: 'abc' }, size: 12 }]
    expect(map({ runs }).lint[0]).toMatchObject({ severity: 'error', code: 'font-unmapped' })
    expect(map({ truncate: true }).lint.map((l) => [l.severity, l.code])).toEqual([['warning', 'text-truncate-unsupported']])
  })

})

describe('font resolution order', () => {
  const style = (name: string, styleName?: string) => ({ runs: [{ start: 0, end: 5, font: { kind: 'alias', name, ...(styleName && { styleName }) }, size: 18 }] })
  const run = (name: string, styleName?: string) => mapText(textNode('t', style(name, styleName)) as TextNode)

  it('(a) an alias-shaped text style name wins over the font', () => {
    const r = run('Inter/Regular', 'Everywhere / Bold / 24')
    expect(r.text?.alias).toBe('$EverywhereBoldFont')
    expect(r.lint).toEqual([])
  })
  it('(a) a style name that is not alias-shaped is ignored', () => expect(run('Everywhere/Medium', 'Body text').text?.alias).toBe('$EverywhereMediumFont'))
  it('(b) family Everywhere + style Medium maps without lint', () => {
    const r = run('Everywhere/Medium')
    expect(r.text?.alias).toBe('$EverywhereMediumFont')
    expect(r.lint).toEqual([])
  })
  it.each([
    ['Inter/Regular', '$EverywhereFont'],
    ['Inter/Bold', '$EverywhereBoldFont'],
    ['Roboto/SemiBold', '$EverywhereMediumFont'],
    ['Arial/Medium', '$EverywhereMediumFont'],
    ['Helvetica Neue/Regular', '$EverywhereFont'],
    ['Consolas/Regular', '$ConsoleFont'],
    ['Courier New/Bold', '$ConsoleFont'],
    ['JetBrains Mono/Regular', '$ConsoleFont'],
    ['Roboto Mono/Regular', '$ConsoleFont'],
    ['Dancing Script/Regular', '$HandwrittenFont'],
    ['Futura/Regular', undefined]
  ])('(c) fallback %s -> %s', (name, alias) => expect(fallbackAlias(name)).toBe(alias))
  it('(c) Inter/Regular used to be font-unmapped; now a font-fallback warning that names the Figma font', () => {
    const r = run('Inter/Regular', 'Body')
    expect(r.text?.alias).toBe('$EverywhereFont')
    expect(r.lint).toMatchObject([{ severity: 'warning', code: 'font-fallback' }])
    expect(r.lint[0]!.message).toContain('Inter/Regular')
    expect(r.lint[0]!.message).toContain('Body')
  })
  it('(d) unknown font stays a font-unmapped error with the Figma data', () => {
    const r = run('Futura/Regular', 'Body')
    expect(r.text).toBeUndefined()
    expect(r.lint).toMatchObject([{ severity: 'error', code: 'font-unmapped' }])
    expect(r.lint[0]!.message).toContain('Futura/Regular')
  })
})

describe('compileSwf-facing font info (mapText.font)', () => {
  const f = (name: string, styleName?: string) =>
    mapText(textNode('t', { runs: [{ start: 0, end: 5, font: { kind: 'alias', name, ...(styleName && { styleName }) }, size: 18 }] }) as TextNode).font
  it.each([
    ['text style', f('Inter/Regular', 'Everywhere / Bold / 24'), { figmaFont: 'Inter/Regular', styleName: 'Everywhere / Bold / 24', alias: '$EverywhereBoldFont' }],
    ['family/style', f('Everywhere/Medium'), { figmaFont: 'Everywhere/Medium', alias: '$EverywhereMediumFont' }],
    ['fallback', f('Inter/Bold', 'Body'), { figmaFont: 'Inter/Bold', styleName: 'Body', alias: '$EverywhereBoldFont' }],
    ['unmapped', f('Futura/Regular'), { figmaFont: 'Futura/Regular' }]
  ])('via %s', (via, font, rest) => expect(font).toEqual({ ...rest, via }))
})

describe('describeTextMapping (shared with the Inspector)', () => {
  const t = (over: Record<string, unknown>) => textNode('1:1', over) as Extract<Node, { type: 'text' }>
  it('auto width: autoSize, no wrap; auto height wraps; fixed is a fixed field', () => {
    expect(describeTextMapping(t({ sizing: 'autoWidth' })).sizing.flags).toEqual({ wordWrap: false, multiline: false, autoSize: true })
    expect(describeTextMapping(t({ sizing: 'autoHeight' })).sizing.flags).toEqual({ wordWrap: true, multiline: true, autoSize: true })
    expect(describeTextMapping(t({ sizing: 'fixed' })).sizing.flags).toEqual({ wordWrap: true, multiline: true, autoSize: false })
  })
  it('lists only the GFx extensions in use and agrees with mapText', () => {
    const n = t({ sizing: 'autoWidth', verticalAlign: 'center', textFit: 'shrink' })
    const f = describeTextMapping(n)
    expect(f.verticalAlign).toBe('center')
    expect(f.textAutoSize).toBe('shrink')
    expect(f.letterSpacingPx).toBeUndefined()
    const m = mapText(n).text!
    expect(m.field).toMatchObject(f.sizing.flags)
    expect(m.script).toMatchObject({ verticalAlign: 'center', textAutoSize: 'shrink' })
  })
})
