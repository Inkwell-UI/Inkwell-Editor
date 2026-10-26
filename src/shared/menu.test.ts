// Names, MenuDef, default INI and the menu lint codes (S1, S2, S9), pure.
import { MenuDef, MenuSettings, parseIni, findMenuIni, resolveMenu, MENU_SLOTS, MENU_WARN_THRESHOLD, RUNTIME_LINT_CODES } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { buildMenuDef, defaultMenuSettings, flatMenuSettings, menuLint, menuSwfName, menuSwfPath, minRuntimeOf, modIniText, resolveMenuNames, type MenuSource } from './menu'

const src = (swf: string, over: Record<string, unknown> = {}): MenuSource => ({ swf, settings: MenuSettings.parse({ specVersion: 6, ...over }) })

describe('names', () => {
  it('menu name <modId>_<Swf>, swf Interface/Inkwell/<modId>/<Swf>.swf (O2, one constant), overridable from menu.json', () => {
    expect(resolveMenuNames('MyMod', src('wheel'))).toEqual({ name: 'MyMod_Wheel', swf: 'Interface/Inkwell/MyMod/Wheel.swf', file: 'Wheel' })
    expect(menuSwfPath('MyMod', 'Wheel')).toBe('Interface/Inkwell/MyMod/Wheel.swf')
    expect(resolveMenuNames('MyMod', src('wheel', { name: 'Custom_Name', swf: 'Interface/Other/W.swf' }))).toMatchObject({ name: 'Custom_Name', swf: 'Interface/Other/W.swf' })
  })
  it('the SWF stem is letters, digits and _ with a capital first letter, never empty or hostile', () => {
    expect(menuSwfName('main-menu')).toBe('Main_menu')
    expect(menuSwfName('3d view')).toBe('M3d_view')
    expect(menuSwfName('..')).toBe('M__')
    expect(menuSwfName('a/b')).toBe('A_b')
  })
})

describe('flat layout (O2 fallback)', () => {
  it('flatMenuSettings puts the SWF at Interface/<menuName>.swf, in the MenuDef too; the default stays the sub-path', () => {
    const m = src('menu')
    const flat = { ...m, settings: flatMenuSettings('MyMod', 'menu', m.settings) }
    expect(resolveMenuNames('MyMod', flat).swf).toBe('Interface/MyMod_Menu.swf')
    expect(buildMenuDef('MyMod', flat).def?.swf).toBe('Interface/MyMod_Menu.swf')
    expect(buildMenuDef('MyMod', m).def?.swf).toBe('Interface/Inkwell/MyMod/Menu.swf')
  })
})

describe('MenuDef', () => {
  it('is what the Spec schema accepts, with the effective input context and the computed runtime requirement', () => {
    const r = buildMenuDef('MyMod', src('wheel', { flags: { modal: true, cursor: true }, triggers: { hotkey: 37, modEvent: 'MyMod_OpenWheel' }, depth: 6, userDefaults: { uiScale: 1.5 } }))
    expect(r.problems).toEqual([])
    expect(r.def).toEqual({
      specVersion: 7, name: 'MyMod_Wheel', swf: 'Interface/Inkwell/MyMod/Wheel.swf', minRuntime: '0.3.0',
      flags: { pausesGame: false, cursor: true, modal: true, closeOnEscape: true }, inputContext: 'menuMode', depth: 6, triggers: { hotkey: 37, papyrus: true, modEvent: 'MyMod_OpenWheel' }
    })
    expect(MenuDef.safeParse(r.def).success).toBe(true)
    expect(minRuntimeOf(src('x'))).toBe('0.3.0')
    expect(buildMenuDef('M', src('x')).def!.inputContext).toBe('none') // not modal
    expect(buildMenuDef('M', src('x', { inputContext: 'menuMode' })).def!.inputContext).toBe('menuMode')
  })
  it('the defaults of a new menu', () => {
    expect(defaultMenuSettings()).toMatchObject({ specVersion: 7, flags: { pausesGame: false, cursor: false, modal: false, closeOnEscape: true }, depth: 3, triggers: { papyrus: true } })
  })
  it('reports the S9 codes: a name that does not fit, a hotkey outside 2..255, a mod event with spaces', () => {
    expect(buildMenuDef('M', { swf: 'x'.repeat(70), settings: defaultMenuSettings() }).problems.map((p) => p.code)).toEqual(['menu-name-invalid'])
    const bad = { swf: 'x', settings: { ...defaultMenuSettings(), triggers: { papyrus: true, hotkey: 1, modEvent: 'a b' } } as MenuSettings }
    expect(buildMenuDef('M', bad).problems.map((p) => p.code)).toEqual(['menu-hotkey-invalid', 'menu-event-invalid'])
    expect(buildMenuDef('M', { swf: 'x', settings: { ...defaultMenuSettings(), triggers: { papyrus: true, hotkey: 256 } } as MenuSettings }).problems.map((p) => p.code)).toEqual(['menu-hotkey-invalid'])
    expect(MenuSettings.safeParse({ specVersion: 6, triggers: { hotkey: 1 } }).success).toBe(false) // the schema agrees: a file with this never loads
  })
})

describe('menu lint (export gate)', () => {
  const many = (n: number): MenuSource[] => Array.from({ length: n }, (_, k) => src(`m${k}`))
  it('warning above 4 menus, error above 16 (the Spec constants), nothing at the thresholds', () => {
    expect([MENU_WARN_THRESHOLD, MENU_SLOTS]).toEqual([4, 16])
    expect(menuLint('M', many(4))).toEqual([])
    expect(menuLint('M', many(5))).toMatchObject([{ severity: 'warning', code: 'menu-limit' }])
    expect(menuLint('M', many(16))).toMatchObject([{ severity: 'warning', code: 'menu-limit' }])
    expect(menuLint('M', many(17))).toMatchObject([{ severity: 'error', code: 'menu-limit' }])
  })
  it('duplicate names ignore case and name the first holder', () => {
    const rows = menuLint('M', [src('a', { name: 'Same_Name' }), src('b', { name: 'same_name' })])
    expect(rows).toMatchObject([{ severity: 'error', code: 'menu-name-duplicate', swf: 'b', message: expect.stringContaining('"a"') }])
  })
  it('every code is a Spec runtime lint code', () => {
    const codes = menuLint('M', [{ swf: 'x'.repeat(70), settings: defaultMenuSettings() }, ...many(17)]).map((r) => r.code)
    for (const c of codes) expect(RUNTIME_LINT_CODES as readonly string[]).toContain(c)
  })
})

describe('default INI', () => {
  it('is the Spec writer: commented keys, the author hotkey shown, a differing default uncommented, one section per menu', () => {
    const text = modIniText('My Mod', 'MyMod', [src('wheel', { triggers: { hotkey: 37 }, userDefaults: { uiScale: 1.25, offsetX: 10, theme: 'Dark' } }), src('list')])
    expect(text).toMatchSnapshot()
    const { ini, problems } = parseIni(text)
    expect(problems).toEqual([])
    expect(Object.keys(ini.menus)).toEqual(['MyMod_Wheel', 'MyMod_List'])
    // precedence: the user INI over the author's JSON; here the INI only sets what differs
    expect(findMenuIni(ini, 'mymod_wheel')).toEqual({ uiScale: 1.25, offsetX: 10, theme: 'Dark' })
    expect(resolveMenu({ triggers: { hotkey: 37, papyrus: true } }, findMenuIni(ini, 'MyMod_Wheel'))).toMatchObject({ openKey: 37, uiScale: 1.25, offsetX: 10 })
  })
})
