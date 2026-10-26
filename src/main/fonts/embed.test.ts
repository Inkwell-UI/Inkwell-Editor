// Embedded custom fonts (SPEC-CHANGES V5): analysis, licence gate, the characters a SWF needs, project files, codegen, and one real FFDec compile (guarded like the other integration tests).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Localization } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { addFont, readFontBytes, readFonts, saveFontSettings } from '../project/fontFiles'
import { generate } from '../swf/generate'
import { compileSwf } from '../swf/compile'
import { frame, swf, textNode } from '../swf/ir.testutil'
import { mapText } from '../swf/text'
import { embeddedFontsFor } from './embedBuild'
import { analyzeFont, charsetChars, fontHash, fontIssues, fontUses, licenseVerdict, planFont, FONT_SIZE_WARN } from './embed'
import { writeLocalization } from '../project/localizationFile'

const fontsDir = resolve(__dirname, '../../../resources/preview-fonts')
const mono = readFileSync(join(fontsDir, 'ShareTechMono-Regular.ttf'))
const barlow = readFileSync(join(fontsDir, 'BarlowCondensed-Bold.ttf'))

describe('analyzeFont', () => {
  it('reads the family, flags, line height and the characters of a real OFL font', () => {
    const i = analyzeFont(mono)
    expect(i.family).toMatch(/Share Tech Mono/i)
    expect(i.fsType).toBe(0)
    expect(i.codePoints?.has(0x41)).toBe(true)
    expect(i.codePoints?.has(0xfc)).toBe(true) // ü
    expect(i.codePoints?.has(0x4e00)).toBe(false) // no CJK
    expect(i.lineHeight).toBeGreaterThan(0.8)
    expect(i.lineHeight).toBeLessThan(2)
    expect(i.glyphCount).toBeGreaterThan(100)
    expect(i.bytes).toBe(mono.length)
  })
  it('refuses what is not TrueType', () => {
    expect(() => analyzeFont(Buffer.from('OTTO' + 'x'.repeat(40)))).toThrow()
    expect(() => analyzeFont(Buffer.alloc(4))).toThrow()
  })
  it('hashes by content: 40 hex digits', () => {
    expect(fontHash(mono)).toMatch(/^[0-9a-f]{40}$/)
    expect(fontHash(mono)).not.toBe(fontHash(barlow))
  })
})

describe('licence verdict (fsType)', () => {
  it.each([
    [0, undefined, undefined],
    [0x2, 'font-license-restricted', undefined],
    [0x100, 'font-license-restricted', undefined],
    [0x200, 'font-license-restricted', undefined],
    [0x4, undefined, 'font-license-restricted-embedding'],
    [0x8, undefined, 'font-license-restricted-embedding']
  ])('fsType %i', (fs, err, warn) => {
    const v = licenseVerdict(fs)
    expect(v.error?.code).toBe(err)
    expect(v.warning?.code).toBe(warn)
  })
})

describe('characters', () => {
  it('charsets and extra characters: unique, sorted, printable', () => {
    expect(charsetChars(['basicLatin'])).toHaveLength(95)
    expect(charsetChars(['latin1'], 'ZZ€')).toBe(charsetChars(['latin1'], '€Z'))
    expect(charsetChars([], 'ba\u0007a')).toBe('ab')
    expect(charsetChars(['nope'])).toBe('')
  })
  const info = analyzeFont(mono)
  const use = (text: string, key?: string) => ({ swf: 'm', nodeId: 'n', layer: 'Title', text, ...(key ? { key } : {}) })
  it('plans the used characters plus the charsets, limited to what the font maps', () => {
    const p = planFont('h'.repeat(40), info, { charsets: [], extraChars: '' }, [use('Hi 12:34')])
    expect(p.chars).toBe(' 1234:Hi')
    expect(p.missing).toEqual([])
    const withSet = planFont('h'.repeat(40), info, { charsets: ['basicLatin'], extraChars: '' }, [use('Hi')])
    expect([...withSet.chars]).toHaveLength(95)
  })
  it('names a character the font lacks, for the layer and for a translation', () => {
    const loc = Localization.parse({ specVersion: 7, namespace: 'N', source: 'ENGLISH', languages: ['ENGLISH', 'JAPANESE'], entries: { $K: { ENGLISH: 'Reset', JAPANESE: '装備' } } })
    const p = planFont('h'.repeat(40), info, { charsets: [], extraChars: '' }, [use('Reset', '$K'), { ...use('日本'), nodeId: 'n2', layer: 'Other' }], loc)
    expect(p.missing.map((m) => [m.where, m.chars])).toEqual([['$K in JAPANESE', ['装', '備']], ['"Other"', ['日', '本']]])
    expect(p.chars).not.toContain('日')
    const issues = fontIssues(info, p, [use('Reset', '$K')])
    expect(issues.filter((i) => i.code === 'font-subset-missing-glyph')).toHaveLength(2)
    expect(issues.every((i) => i.severity === 'error')).toBe(true)
  })
  it('warns about size: the file size scaled by the share of embedded glyphs', () => {
    const big = { ...info, bytes: 3 * 1024 * 1024, glyphCount: 20000 }
    const lots = planFont('h'.repeat(40), big, { charsets: ['basicLatin', 'latin1', 'latinExtendedA'], extraChars: '' }, [use('x')])
    expect(lots.estimatedBytes).toBeGreaterThan(0)
    const huge = { ...info, bytes: 40 * 1024 * 1024, glyphCount: 600 }
    expect(fontIssues(huge, planFont('h'.repeat(40), huge, { charsets: ['basicLatin', 'latin1'], extraChars: '' }, [use('x')]), [use('x')]).map((i) => i.code)).toContain('font-size-large')
    expect(FONT_SIZE_WARN).toBe(262144)
  })
  it('the licence flag blocks and warns through fontIssues', () => {
    const restricted = { ...info, fsType: 0x2 }
    const p = planFont('h'.repeat(40), restricted, { charsets: [], extraChars: '' }, [use('a')])
    expect(fontIssues(restricted, p, [use('a')]).map((i) => `${i.severity}:${i.code}`)).toEqual(['error:font-license-restricted'])
    expect(fontIssues({ ...info, fsType: 0x4 }, p, [use('a')]).map((i) => `${i.severity}:${i.code}`)).toEqual(['warning:font-license-restricted-embedding'])
  })
  it('fontUses groups the keyed or plain text layers by font hash', () => {
    const ir = swf([frame('r', ['a', 'b']), textNode('a', { content: 'A' }), textNode('b', { content: 'B' })])
    const m = fontUses('menu', ir, { a: { font: 'x'.repeat(40), locKey: '$K' }, b: { font: 'y'.repeat(40) }, r: { font: 'z' } })
    expect([...m.keys()]).toEqual(['x'.repeat(40), 'y'.repeat(40)])
    expect(m.get('x'.repeat(40))).toMatchObject([{ nodeId: 'a', key: '$K', text: 'A' }])
  })
})

describe('project fonts', () => {
  it('adds a font once, lists it, changes its settings, builds its plan', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-fonts-'))
    expect(await readFonts(dir)).toEqual({ fonts: [] })
    expect(await addFont(dir, Buffer.from('not a font'), 'junk.ttf')).toMatchObject({ ok: false, error: expect.stringContaining('junk.ttf') })
    const a = await addFont(dir, mono, 'ShareTechMono-Regular.ttf')
    if (!a.ok) throw new Error(a.error)
    expect(a.existed).toBe(false)
    expect(a.font).toMatchObject({ hash: fontHash(mono), charsets: ['basicLatin', 'latin1'], extraChars: '', source: 'ShareTechMono-Regular.ttf' })
    expect(await addFont(dir, mono)).toMatchObject({ ok: true, existed: true })
    expect((await readFontBytes(dir, a.font.hash))?.equals(mono)).toBe(true)
    expect(await saveFontSettings(dir, a.font.hash, { charsets: ['basicLatin'], extraChars: 'ÄÖ' })).toEqual({ ok: true })
    expect((await readFonts(dir)).fonts[0]).toMatchObject({ charsets: ['basicLatin'], extraChars: 'ÄÖ' })
    expect(await saveFontSettings(dir, 'a'.repeat(40), { charsets: [], extraChars: '' })).toMatchObject({ ok: false })
    expect(await saveFontSettings(dir, 'nothash', { charsets: [], extraChars: '' })).toMatchObject({ ok: false })

    // the build side: layers that use the font, its translations, the lint
    await writeLocalization(dir, { specVersion: 7, namespace: 'N', source: 'ENGLISH', languages: ['ENGLISH', 'GERMAN'], entries: { $K: { ENGLISH: 'Reset', GERMAN: 'Zurücksetzen' } } })
    const ir = swf([frame('r', ['a']), textNode('a', { content: 'Reset' })], { target: { kind: 'customMenu' } })
    const e = await embeddedFontsFor(dir, 'menu', ir, { a: { font: a.font.hash, locKey: '$K' } })
    expect(e.issues).toEqual([])
    expect(e.option?.byNode).toEqual({ a: a.font.hash })
    const chars = e.option!.fonts[a.font.hash]!.chars
    expect(chars).toContain('ü') // from the German translation (and the extra characters)
    expect(chars).toContain('Ä')
    expect(e.bytes(a.font.hash)?.equals(mono)).toBe(true)
    // an unknown font hash: no entry, so the compiler says font-file-missing
    const gone = await embeddedFontsFor(dir, 'menu', ir, { a: { font: 'f'.repeat(40) } })
    expect(gone.option?.fonts).toEqual({})
    // none used: nothing
    expect(await embeddedFontsFor(dir, 'menu', ir, {})).toMatchObject({ issues: [] })
  })
})

describe('codegen of embedded fonts', () => {
  const ir = swf([frame('r', ['t']), textNode('t', { content: 'Hi' })], { target: { kind: 'customMenu' } })
  it('a layer with an embedded font gets a DefineFont3 placeholder and no alias import', () => {
    const g = generate(ir, { modId: 'M', embeddedFonts: { byNode: { t: 'h'.repeat(40) }, fonts: { ['h'.repeat(40)]: { family: 'ShareTechMono', lineHeight: 1.3, chars: ' Hi' } } } })
    expect(g.embeddedFonts).toEqual([{ charId: expect.any(Number), name: 'ShareTechMono', chars: ' Hi', hash: 'h'.repeat(40) }])
    expect(g.fonts[0]).toMatchObject({ via: 'embedded', embedded: 'ShareTechMono' })
    expect(g.lint).toEqual([])
    const tags = g.tags.map((b) => b.readUInt16LE(0) >> 6)
    expect(tags).toContain(75) // DefineFont3
    expect(tags).not.toContain(71) // no ImportAssets2
  })
  it('the same font on two layers is one DefineFont3; a hash without a file is an error and falls back', () => {
    const two = swf([frame('r', ['a', 'b']), textNode('a'), textNode('b')], { target: { kind: 'customMenu' } })
    const h = 'h'.repeat(40)
    const g = generate(two, { modId: 'M', embeddedFonts: { byNode: { a: h, b: h }, fonts: { [h]: { family: 'F', chars: ' ab' } } } })
    expect(g.embeddedFonts).toHaveLength(1)
    const missing = generate(ir, { modId: 'M', embeddedFonts: { byNode: { t: h }, fonts: {} } })
    expect(missing.lint.map((l) => l.code)).toContain('font-file-missing')
  })
  it('the leading follows the font natural line height', () => {
    const n = textNode('t', { lineHeight: { unit: 'px', value: 30 } }) as Parameters<typeof mapText>[0]
    const lead = (lh?: number): number => mapText(n, undefined, { family: 'F', ...(lh ? { lineHeight: lh } : {}) }).text!.field.leadingPx
    expect(lead(1.5)).toBeCloseTo(30 - 18 * 1.5)
    expect(lead()).toBeCloseTo(30 - 18 * 1.2) // default natural line height
    expect(mapText(n, undefined, { family: 'F' }).lint).toEqual([]) // no alias rule applies to an embedded font
  })
})

const ffdecDir = process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
const javaPath = process.env['INKWELL_JAVA'] ?? 'java'
const jarPath = resolve(__dirname, '../../../tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const can = (() => {
  try {
    execFileSync(javaPath, ['-version'], { stdio: 'ignore' })
  } catch {
    return false
  }
  return existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath) && existsSync(join(ffdecDir, 'ffdec-cli.jar'))
})()

describe.skipIf(!can)('embedded font through FFDec', () => {
  it('compiles a SWF whose DefineFont3 holds exactly the planned glyphs and no alias import', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-embed-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const h = fontHash(mono)
      const ir = swf([frame('f', ['t']), textNode('t', { content: 'Zurücksetzen 12:34' })], { id: 'embedtest', target: { kind: 'customMenu' } })
      const r = await compileSwf(ir, { modId: 'EmbedMod', buildDir: dir, ffdec, embeddedFonts: { byNode: { t: h }, fonts: { [h]: { family: 'ShareTechMono', lineHeight: 1.2, chars: ' 1234:Zeknrstuü' } } }, embeddedFontBytes: () => mono })
      expect(r.lint).toEqual([])
      const xmlPath = join(dir, 'out.xml')
      execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', r.swfPath, xmlPath], { stdio: 'ignore' })
      const xml = readFileSync(xmlPath, 'utf8')
      const font = /<item type="DefineFont3Tag"[\s\S]*?<codeTable>([\s\S]*?)<\/codeTable>/.exec(xml)
      expect(font).toBeTruthy()
      const codes = [...font![1]!.matchAll(/<item>(\d+)<\/item>/g)].map((m) => Number(m[1]))
      expect(String.fromCodePoint(...codes)).toBe(' 1234:Zeknrstuü')
      expect(xml).toMatch(/fontName="ShareTechMono"/)
      expect(xml).not.toMatch(/ImportAssets2Tag/)
      expect(xml).toMatch(/<item type="DefineEditTextTag"[^>]*useOutlines="true"/)
    } finally {
      ffdec.stop()
    }
  }, 60_000)
})
