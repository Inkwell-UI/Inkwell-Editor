import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateScripts, isPapyrusName } from './papyrus'
import { compilePapyrus, parseDiagnostics, STUBS_DIR } from './papyrusCompiler'

const placement = { hAnchor: 'right', vAnchor: 'top', x: 1253.333, y: 26.667, alpha: 100 } as const
const scripts = () => generateScripts({ modId: 'WidgetMod', widgetName: 'Hud', displayName: 'My "Widget"', placement })
const texts = [{ nodeId: '44:5', layer: '$NAME', name: 'title', path: 'title' }, { nodeId: '44:6', layer: '$DESC', name: 'description', path: 'description' }]
const popupScripts = () => generateScripts({ modId: 'WidgetMod', widgetName: 'Hud', displayName: 'Popup', placement, texts })

describe('generated Papyrus', () => {
  it('widget script (snapshot)', () => expect(scripts()[0]!.source).toMatchSnapshot())
  it('empty Instance script (snapshot)', () => expect(scripts()[1]).toMatchSnapshot())
  it('popup: typed SetTexts/Show/Hide, an off-by-default test hotkey, calls remembered until ready (snapshot)', () => {
    const src = popupScripts()[0]!.source
    expect(src).toContain('Function SetTexts(String asTitle, String asDescription)')
    expect(src).toContain('Function Show(String asTitle, String asDescription, Float afHoldSeconds = 4.0)')
    expect(src).toContain('Function Hide()')
    expect(src).toContain('UI.InvokeStringA("HUD Menu", WidgetRoot + ".setTexts", _texts)')
    expect(src).toContain('Game.GetFormFromFile(2048, "WidgetMod.esp") as WidgetMod_Hud')
    expect(src).toContain('Int Property DebugHotkey = 0 Auto') // off unless the project sets it
    expect(src).not.toContain('cgf')
    expect(src).toContain('If DebugHotkey > 0 && aiKeyCode == DebugHotkey && !Utility.IsInMenuMode()')
    // OnWidgetReset re-applies texts and a pending Show
    const reset = src.slice(src.indexOf('Event OnWidgetReset'), src.indexOf('EndEvent', src.indexOf('Event OnWidgetReset')))
    expect(reset).toContain('If _pendingShow')
    expect(src).toMatchSnapshot()
  })
  it('popup: the project hotkey becomes the property default and is registered in OnWidgetReset; bad codes throw', () => {
    const src = generateScripts({ modId: 'WidgetMod', widgetName: 'Hud', displayName: 'Popup', placement, texts, debugHotkey: 65 })[0]!.source
    expect(src).toContain('Int Property DebugHotkey = 65 Auto')
    const reset = src.slice(src.indexOf('Event OnWidgetReset'), src.indexOf('EndEvent', src.indexOf('Event OnWidgetReset')))
    expect(reset).toContain('RegisterForKey(DebugHotkey)')
    expect(() => generateScripts({ modId: 'WidgetMod', widgetName: 'Hud', displayName: 'Popup', placement, texts, debugHotkey: 300 })).toThrow(/scan code/)
  })
  it('rejects names that are not Papyrus identifiers', () => {
    expect(isPapyrusName('Ok1')).toBe(true)
    expect(() => generateScripts({ modId: 'bad mod', widgetName: 'Hud', displayName: 'x', placement })).toThrow(/modId/)
    expect(() => generateScripts({ modId: 'M', widgetName: '1Hud', displayName: 'x', placement })).toThrow(/widget name/)
  })
})

describe('header stubs', () => {
  const stub = (n: string): string => readFileSync(join(STUBS_DIR, `${n}.psc`), 'utf8')
  it('declare the SkyUI position/anchor/alpha members as full properties, not auto', () => {
    const src = stub('SKI_WidgetBase')
    for (const [type, name] of [['string', 'HAnchor'], ['string', 'VAnchor'], ['float', 'X'], ['float', 'Y'], ['float', 'Alpha']]) {
      const line = src.split(/\r?\n/).find((l) => new RegExp(`^${type} property ${name}\\b`, 'i').test(l))
      expect(line, `${name} declared`).toBeDefined()
      expect(line).not.toMatch(/\bauto\b/i)
      expect(src).toMatch(new RegExp(`property ${name}\\s*\\n\\s*${type} Function get\\(\\)`, 'i')) // has a getter body
    }
  })
  it('are marked original', () => {
    for (const f of readdirSync(STUBS_DIR)) expect(readFileSync(join(STUBS_DIR, f), 'utf8')).toMatch(/^;; original stub/)
  })
})

describe('parseDiagnostics', () => {
  it('turns compiler output into papyrus-compile-failed issues and drops duplicates and source excerpts', () => {
    const out = [
      'C:\\tmp\\src\\Bad.psc:3:2: Checker error: undefined identifier `Foo`',
      '    3 |     Foo = 1',
      'C:\\tmp\\src\\Bad.psc:4:6: Checker error: value with type `String` cannot be assigned to a variable with type `Int`',
      'C:\\tmp\\src\\Bad.psc:4:6: Checker error: value with type `String` cannot be assigned to a variable with type `Int`',
      'failed to compile files, 3 errors'
    ].join('\n')
    expect(parseDiagnostics(out)).toEqual([
      { severity: 'error', code: 'papyrus-compile-failed', message: 'Bad.psc:3:2: undefined identifier `Foo`', nodeId: 'Bad' },
      { severity: 'error', code: 'papyrus-compile-failed', message: 'Bad.psc:4:6: value with type `String` cannot be assigned to a variable with type `Int`', nodeId: 'Bad' }
    ])
  })
})

const exe = process.env['INKWELL_PAPYRUS']
describe.skipIf(!exe || !existsSync(exe))('Papyrus compiler (real, INKWELL_PAPYRUS)', () => {
  it('compiles the generated scripts to .pex starting with the Papyrus magic bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-papyrus-'))
    const r = await compilePapyrus({ papyrusExe: exe!, scripts: scripts(), workDir: dir })
    expect(r.lint).toEqual([])
    expect(Object.keys(r.pex).sort()).toEqual(['WidgetMod_Hud', 'WidgetMod_HudInstance'])
    for (const pex of Object.values(r.pex)) expect([...pex.subarray(0, 4)]).toEqual([0xfa, 0x57, 0xc0, 0xde])
  })
  it('compiles the popup scripts', async () => {
    const scripts = generateScripts({ modId: 'WidgetMod', widgetName: 'Hud', displayName: 'Popup', placement, texts, debugHotkey: 65 })
    const r = await compilePapyrus({ papyrusExe: exe!, scripts, workDir: mkdtempSync(join(tmpdir(), 'inkwell-papyrus-')) })
    expect(r.lint).toEqual([])
    expect(Object.keys(r.pex).sort()).toEqual(['WidgetMod_Hud', 'WidgetMod_HudInstance'])
  })
  it('reports errors as lint issues and returns no .pex', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-papyrus-'))
    const bad = { name: 'Bad', source: 'Scriptname Bad extends SKI_WidgetBase\nEvent OnWidgetInit()\n\tFoo = 1\nEndEvent\n' }
    const r = await compilePapyrus({ papyrusExe: exe!, scripts: [bad], workDir: dir })
    expect(r.pex).toEqual({})
    expect(r.lint[0]).toMatchObject({ severity: 'error', code: 'papyrus-compile-failed' })
    expect(r.lint[0]!.message).toContain('Bad.psc:3')
  })
})
