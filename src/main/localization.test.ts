// Localization in the editor (SPEC-CHANGES V2, V3, V13): edit operations, lint, codegen of keyed texts, the menu glue and the deploy files. No FFDec needed.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BRIDGE_MEMBERS, Localization, parseTranslationFile, type Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { menuClassSource } from './codegen/menuGlue'
import { commitDeploy, prepareDeploy, type DeployInput, type DeploySwf } from './deploy/run'
import { planDeploy } from './deploy/plan'
import { keyedTexts, localizationLint, type LocSwf } from './lint/localization'
import { defaultLocalization, readLocalization, writeLocalization } from './project/localizationFile'
import { frame, swf, textNode } from './swf/ir.testutil'
import { generate } from './swf/generate'
import { locKeysOf, patchNodeOverlay, overlayProblems } from '../shared/overlay'
import { addLanguage, ensureKey, mergeCsv, removeKey, removeLanguage, renameKey, setCell } from '../shared/localizationOps'
import { minRuntimeFor } from '../shared/runtimeFeatures'
import { fromCsv, toCsv } from '@inkwell-ui/spec'

const noFfdec = { build: () => Promise.reject(new Error('FFDec must not be used here')) }
const loc = (over: Record<string, unknown> = {}): Localization =>
  Localization.parse({
    specVersion: 7, namespace: 'Inkwell_M', source: 'ENGLISH', languages: ['ENGLISH', 'GERMAN'],
    entries: { $Inkwell_M_Start: { ENGLISH: 'Hello', GERMAN: 'Hallo' }, $Inkwell_M_Reset: { ENGLISH: 'Reset', GERMAN: 'Zurücksetzen' } }, ...over
  })

/** A custom menu SWF with one keyed text ('t', content "Hello") and one plain text ('p'). */
const menuIr = (kind: LocSwf['kind'] = 'customMenu'): Swf => {
  const t = textNode('t', { content: 'Hello', name: 'Title' })
  const p = textNode('p', { content: 'plain', name: 'Plain' })
  return swf([frame('r', ['t', 'p']), t, p], { target: { kind } })
}

describe('edit operations', () => {
  it('ensureKey keeps existing texts, fills an empty source, matches ignoring case', () => {
    const l = loc()
    expect(ensureKey(l, '$Inkwell_M_New', 'New')).toMatchObject({ entries: { $Inkwell_M_New: { ENGLISH: 'New' } } })
    expect(ensureKey(l, '$inkwell_m_start', 'Other')).toBe(l)
    const empty = loc({ entries: { $A: { GERMAN: 'x' } } })
    expect(ensureKey(empty, '$a', 'Src').entries['$A']).toEqual({ GERMAN: 'x', ENGLISH: 'Src' })
  })
  it('setCell sets, clears and keeps the stored key spelling', () => {
    const l = setCell(loc(), '$INKWELL_M_START', 'GERMAN', 'Los')
    expect(l.entries['$Inkwell_M_Start']!['GERMAN']).toBe('Los')
    expect(setCell(l, '$Inkwell_M_Start', 'GERMAN', '').entries['$Inkwell_M_Start']).toEqual({ ENGLISH: 'Hello' })
    expect(Object.keys(setCell(loc(), '$Fresh', 'ENGLISH', 'x').entries)).toContain('$Fresh')
  })
  it('renameKey, removeKey, languages', () => {
    const l = loc()
    expect(Object.keys(renameKey(l, '$Inkwell_M_Start', '$Inkwell_M_Go').entries)).toEqual(['$Inkwell_M_Reset', '$Inkwell_M_Go'])
    expect(renameKey(l, '$Inkwell_M_Start', '$Inkwell_M_Reset')).toBe(l) // would clobber another row
    expect(renameKey(l, '$Missing', '$X')).toBe(l)
    expect(Object.keys(removeKey(l, '$inkwell_m_reset').entries)).toEqual(['$Inkwell_M_Start'])
    const f = addLanguage(l, 'FRENCH')
    expect(f.languages).toEqual(['ENGLISH', 'GERMAN', 'FRENCH'])
    expect(addLanguage(f, 'FRENCH')).toBe(f)
    expect(removeLanguage(l, 'ENGLISH')).toBe(l) // the source stays
    const g = removeLanguage(l, 'GERMAN')
    expect(g.languages).toEqual(['ENGLISH'])
    expect(g.entries['$Inkwell_M_Start']).toEqual({ ENGLISH: 'Hello' })
  })
  it('mergeCsv adds languages, keys and cells, overwrites only cells the CSV has, deletes nothing', () => {
    const l = loc()
    const csv = 'key,ENGLISH,GERMAN,FRENCH\r\n$Inkwell_M_Start,,Los,Allez\r\n$Inkwell_M_Extra,Extra,,\r\n'
    const r = mergeCsv(l, fromCsv(csv))
    expect(r.report).toMatchObject({ languagesAdded: ['FRENCH'], keysAdded: 1, cellsChanged: 1, cellsAdded: 2 })
    expect(r.localization.entries['$Inkwell_M_Start']).toEqual({ ENGLISH: 'Hello', GERMAN: 'Los', FRENCH: 'Allez' })
    expect(r.localization.entries['$Inkwell_M_Reset']).toEqual(l.entries['$Inkwell_M_Reset']) // not in the CSV: untouched
    expect(mergeCsv(l, fromCsv(toCsv(l))).report).toMatchObject({ languagesAdded: [], keysAdded: 0, cellsChanged: 0, cellsAdded: 0 }) // an export imports as no change
  })
})

describe('overlay locKey', () => {
  it('patches, reads and validates', () => {
    const o = patchNodeOverlay({}, 't', { locKey: '$Inkwell_M_Start' })
    expect(locKeysOf(o.nodes as Record<string, { locKey?: unknown }>)).toEqual({ t: '$Inkwell_M_Start' })
    expect(patchNodeOverlay(o, 't', { locKey: null }).nodes).toEqual({})
    expect(overlayProblems(o)).toEqual([])
    expect(overlayProblems({ nodes: { t: { locKey: 'nodollar' } } })).toHaveLength(1)
    expect(overlayProblems({ nodes: { t: { locKey: 5 } } })).toHaveLength(1)
  })
})

describe('localizationFile', () => {
  it('reads nothing, writes validated stable JSON, refuses an unreadable file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-loc-'))
    expect(await readLocalization(dir)).toEqual({})
    expect(defaultLocalization('My-Mod').namespace).toBe('Inkwell_My_Mod')
    expect(await writeLocalization(dir, { nope: 1 })).toMatchObject({ ok: false })
    const w = await writeLocalization(dir, loc())
    expect(w.ok).toBe(true)
    expect((await readLocalization(dir)).localization).toEqual(loc())
    expect(readFileSync(join(dir, 'localization.json'), 'utf8').endsWith('}\n')).toBe(true)
    writeFileSync(join(dir, 'localization.json'), '{ broken')
    expect((await readLocalization(dir)).error).toMatch(/localization.json/)
    expect(await writeLocalization(dir, loc())).toMatchObject({ ok: false, error: expect.stringContaining('could not be read') })
  })
})

describe('localization lint', () => {
  const sw = (kind: LocSwf['kind'] = 'customMenu', overlay: LocSwf['overlay'] = { t: { locKey: '$Inkwell_M_Start' } }): LocSwf => ({ name: 'menu', kind, ir: menuIr(kind), overlay })
  const codes = (l: ReturnType<typeof localizationLint>): string[] => l.map((x) => `${x.severity}:${x.code}`)

  it('finds the keyed text layers', () => {
    expect(keyedTexts([sw()])).toMatchObject([{ swf: 'menu', nodeId: 't', key: '$Inkwell_M_Start', text: 'Hello', layer: 'Title' }])
    expect(keyedTexts([{ ...sw(), orphaned: true }])).toEqual([])
    expect(keyedTexts([sw('customMenu', { r: { locKey: '$A' }, zz: { locKey: '$B' } })])).toEqual([]) // not text nodes, or not in the IR
  })
  it('is quiet when everything matches, or when there is nothing keyed and no table', () => {
    expect(localizationLint([sw()], loc({ entries: { $Inkwell_M_Start: { ENGLISH: 'Hello', GERMAN: 'Hallo' } } }))).toEqual([])
    expect(localizationLint([sw('customMenu', {})], undefined)).toEqual([])
  })
  it('errors: invalid key, same key with different text', () => {
    expect(codes(localizationLint([sw('customMenu', { t: { locKey: 'bad key' } })], loc()))).toContain('error:loc-key-invalid')
    const two: LocSwf = { ...sw('customMenu', { t: { locKey: '$K' }, p: { locKey: '$k' } }) }
    expect(codes(localizationLint([two], loc({ entries: { $K: { ENGLISH: 'Hello', GERMAN: 'x' } } })))).toContain('error:loc-key-duplicate')
    const same = { ...two, ir: { ...two.ir, nodes: { ...two.ir.nodes, p: textNode('p', { content: 'Hello' }) } } } as LocSwf
    expect(codes(localizationLint([same], loc({ entries: { $K: { ENGLISH: 'Hello', GERMAN: 'x' } } })))).not.toContain('error:loc-key-duplicate') // one key, one text, two layers is fine
  })
  it('warnings: missing translation, source changed, orphan, widget, no table', () => {
    const l = localizationLint([sw()], loc({ entries: { $Inkwell_M_Start: { ENGLISH: 'Hi' }, $Inkwell_M_Old: { ENGLISH: 'o', GERMAN: 'a' } } }))
    expect(codes(l).sort()).toEqual(['warning:loc-key-orphan', 'warning:loc-source-changed', 'warning:loc-translation-missing'])
    expect(l.find((x) => x.code === 'loc-translation-missing')!.message).toMatch(/^GERMAN: 1 key/)
    expect(codes(localizationLint([sw('hudWidget')], loc()))).toContain('warning:loc-needs-runtime')
    expect(codes(localizationLint([sw()], undefined))).toEqual(['warning:loc-translation-missing'])
  })
  it('a language with all cells is quiet; the lint points at the layer', () => {
    const l = localizationLint([sw()], loc({ entries: { $Inkwell_M_Start: { ENGLISH: 'Zzz', GERMAN: 'Hallo' } } }))
    expect(l).toMatchObject([{ code: 'loc-source-changed', swf: 'menu', nodeId: 't', layerName: 'Title' }])
  })
})

describe('codegen of keyed texts', () => {
  it('a custom menu translates its keyed text in begin(); the compiled text stays the source language', () => {
    const g = generate(menuIr(), { modId: 'M', locKeys: { t: '$Inkwell_M_Start' } })
    expect(g.translatedTexts).toEqual([{ nodeId: 't', path: 'Title', key: '$Inkwell_M_Start' }])
    const menu = g.as2.find((f) => f.path.endsWith('Menu.as'))!.source
    expect(menu).toContain('this.tx(this.base.Title, "$Inkwell_M_Start");')
    expect(menu).toContain('var t = this.bridge.translate(key);')
    expect(menu.indexOf('this.tx(')).toBeLessThan(menu.indexOf('bridge.glueReady();')) // before the graphs start
    expect(JSON.stringify(g.tags.map((b) => b.toString('latin1')))).toContain('Hello')
  })
  it('no keys, no translation code; a HUD widget and the preview build do not translate by themselves', () => {
    expect(generate(menuIr(), { modId: 'M' }).translatedTexts).toEqual([])
    const noKeys = generate(menuIr(), { modId: 'M' }).as2.find((f) => f.path.endsWith('Menu.as'))!.source
    expect(noKeys).not.toContain('this.tx(')
    expect(generate(menuIr('hudWidget'), { modId: 'M', widget: true, locKeys: { t: '$K' } }).translatedTexts).toEqual([])
  })
  it('the stub bridge and the preview mock have translate and language', () => {
    const src = menuClassSource({ modId: 'M', swfCls: 'X', graphs: [], translated: [{ path: 'a.b', key: '$K' }] })
    const stub = src.split('\n').find((l) => l.includes('return { ready:'))!
    for (const m of BRIDGE_MEMBERS) expect(stub).toContain(`${m.name}:`)
    expect(stub).toContain('translate: function(key) { return key; }')
    const preview = generate(menuIr(), { modId: 'M', preview: true, locKeys: { t: '$K' } }).as2.find((f) => f.path === 'frame_1/DoAction.as')!.source
    for (const m of BRIDGE_MEMBERS) expect(preview).toContain(`${m.name}:`)
    expect(preview).toContain('"tr." + key')
  })
})

describe('deploy', () => {
  const deploySwf = (over: Partial<DeploySwf> = {}): DeploySwf => ({ name: 'wheel', orphaned: false, kind: 'customMenu', ir: menuIr(), build: { state: 'done', lint: [] }, overlay: { t: { locKey: '$Inkwell_M_Start' } }, ...over })
  const input = (over: Partial<DeployInput> = {}): DeployInput => {
    const i: DeployInput = { modId: 'M', swfs: [deploySwf()], root: join(mkdtempSync(join(tmpdir(), 'inkwell-locdeploy-')), 'mod'), gameDirs: [], buildDir: mkdtempSync(join(tmpdir(), 'inkwell-build-')), ffdec: noFfdec, vanillaHashes: new Set(), ...over }
    mkdirSync(i.buildDir, { recursive: true })
    writeFileSync(join(i.buildDir, 'wheel.swf'), 'FWS-mine')
    return i
  }

  it('the translation feature raises the runtime to 0.4.0', () => {
    expect(minRuntimeFor(['menu'])).toBe('0.3.0')
    expect(minRuntimeFor(['menu', 'translation'])).toBe('0.4.0')
  })
  it('plans one file per language next to the first keyed menu, and none without keyed text', () => {
    const base = { modId: 'M', root: 'C:\\mods\\M', gameDirs: [], hasPapyrus: false, translationLanguages: ['ENGLISH', 'GERMAN'] }
    const keyed = planDeploy({ ...base, swfs: [{ name: 'wheel', orphaned: false, kind: 'customMenu', features: ['translation'] }] })
    expect(keyed.files.map((f) => f.rel).filter((r) => r.startsWith('Interface/Translations/'))).toEqual(['Interface/Translations/M_ENGLISH.txt', 'Interface/Translations/M_GERMAN.txt'])
    const plain = planDeploy({ ...base, swfs: [{ name: 'wheel', orphaned: false, kind: 'customMenu' }] })
    expect(plain.files.some((f) => f.rel.startsWith('Interface/Translations/'))).toBe(false)
  })
  it('writes the translation files (UTF-16 LE with BOM, source text as fallback), the menu JSON declares them and 0.4.0', async () => {
    const i = input({ localization: loc({ entries: { $Inkwell_M_Start: { ENGLISH: 'Hello', GERMAN: 'Hallo' }, $Inkwell_M_Only: { ENGLISH: 'Only english' } } }) })
    const r = await prepareDeploy(i)
    if (!r.ok) throw new Error(r.error)
    expect(r.prepared.info.map((f) => f.rel)).toEqual([
      'Interface/Inkwell/M/Wheel.swf', 'SKSE/Plugins/Inkwell/menus/M_Wheel.json', 'SKSE/Plugins/Inkwell/M.ini', 'Interface/Translations/M_ENGLISH.txt', 'Interface/Translations/M_GERMAN.txt'
    ])
    expect((await commitDeploy(i, r.prepared)).ok).toBe(true)
    const json = JSON.parse(readFileSync(join(i.root, 'SKSE', 'Plugins', 'Inkwell', 'menus', 'M_Wheel.json'), 'utf8'))
    expect(json).toMatchObject({ minRuntime: '0.4.0', translations: 'M' })
    const de = parseTranslationFile(readFileSync(join(i.root, 'Interface', 'Translations', 'M_GERMAN.txt')))
    expect(de).toMatchObject({ encoding: 'utf-16le', issues: [], entries: { $Inkwell_M_Start: 'Hallo', $Inkwell_M_Only: 'Only english' } })
    const en = parseTranslationFile(readFileSync(join(i.root, 'Interface', 'Translations', 'M_ENGLISH.txt')))
    expect(en.entries['$Inkwell_M_Start']).toBe('Hello')
    expect(r.prepared.issues.map((x) => x.code)).toContain('loc-key-orphan') // $Inkwell_M_Only is on no layer: a warning, the deploy goes on
  })
  it('without keyed text the menu stays at 0.3.0 and has no translations field', async () => {
    const i = input({ swfs: [deploySwf({ overlay: {} })], localization: loc() })
    const r = await prepareDeploy(i)
    if (!r.ok) throw new Error(r.error)
    expect(r.prepared.info.map((f) => f.rel).some((x) => x.includes('Translations'))).toBe(false)
    expect(await commitDeploy(i, r.prepared)).toMatchObject({ ok: true })
    const json = JSON.parse(readFileSync(join(i.root, 'SKSE', 'Plugins', 'Inkwell', 'menus', 'M_Wheel.json'), 'utf8'))
    expect(json.minRuntime).toBe('0.3.0')
    expect(json.translations).toBeUndefined()
  })
  it('an invalid key blocks the deploy (error), nothing is written', async () => {
    const i = input({ swfs: [deploySwf({ overlay: { t: { locKey: 'bad key' } } })], localization: loc() })
    const r = await prepareDeploy(i)
    if (!r.ok) throw new Error(r.error)
    expect(r.prepared.issues.some((x) => x.severity === 'error' && x.code === 'loc-key-invalid')).toBe(true)
    expect([...r.prepared.files.keys()].some((k) => k.includes('Translations'))).toBe(false)
  })
})
