import { describe, expect, it } from 'vitest'
import { isConfirmed, isGameData, packageFileName, planDeploy, resolveTarget, safeJoin, targetList, withConfirmed, type SwfLike } from './plan'
import { resolveSettings } from '../settings'

const ROOT = 'C:\\Modding\\MO2\\mods\\My Mod'
const hud: SwfLike = { name: 'hud', orphaned: false, kind: 'hudWidget' }
const menu: SwfLike = { name: 'wheel', orphaned: false, kind: 'customMenu' }
const base = { modId: 'MyMod', root: ROOT, gameDirs: ['C:\\Games\\Skyrim Special Edition'], hasPapyrus: true }

describe('planDeploy', () => {
  it('hudWidget: SWF, sources, scripts and plugin in the mod layout', () => {
    const p = planDeploy({ ...base, swfs: [hud] })
    expect(p.errors).toEqual([])
    expect(p.files.map((f) => f.rel)).toEqual([
      'Interface/exported/widgets/MyMod/Hud.swf', 'Source/Scripts/MyMod_Hud.psc', 'Source/Scripts/MyMod_HudInstance.psc',
      'Scripts/MyMod_Hud.pex', 'Scripts/MyMod_HudInstance.pex', 'MyMod.esp'
    ])
  })
  it('without a Papyrus compiler: SWF and sources, a papyrus-compiler-missing warning, no pex or plugin', () => {
    const p = planDeploy({ ...base, hasPapyrus: false, swfs: [hud] })
    expect(p.files.map((f) => f.rel)).toEqual(['Interface/exported/widgets/MyMod/Hud.swf', 'Source/Scripts/MyMod_Hud.psc', 'Source/Scripts/MyMod_HudInstance.psc'])
    expect(p.lint.map((l) => l.code)).toContain('papyrus-compiler-missing')
  })
  it('customMenu: Interface/<name>.swf only, with the runtime-JSON note; menu replacements are skipped; orphans ignored', () => {
    const p = planDeploy({ ...base, swfs: [menu, { name: 'inv', orphaned: false, kind: 'menuReplacement' }, { name: 'old', orphaned: true, kind: 'customMenu' }] })
    expect(p.files).toEqual([{ rel: 'Interface/wheel.swf', swf: 'wheel' }])
    expect(p.notes[0]).toContain('runtime menu JSON')
    expect(p.lint.map((l) => l.code)).toEqual(['menu-replacement-skipped'])
  })
  it('only: just the named SWF; unknown name is an error', () => {
    expect(planDeploy({ ...base, swfs: [hud, menu], only: 'wheel' }).files.map((f) => f.rel)).toEqual(['Interface/wheel.swf'])
    expect(planDeploy({ ...base, swfs: [hud], only: 'nope' }).errors[0]).toContain('nope')
  })
  it('refuses the game Data folder (detected install and the name pattern), tested both ways', () => {
    const a = planDeploy({ ...base, swfs: [hud], root: 'C:\\Games\\Skyrim Special Edition\\Data' })
    expect(a.errors[0]).toMatch(/Data folder/)
    expect(planDeploy({ ...base, swfs: [hud], root: 'c:\\games\\skyrim special edition\\data\\sub' }).errors[0]).toMatch(/Data folder/)
    expect(planDeploy({ ...base, swfs: [hud], gameDirs: [], root: 'D:\\Steam\\steamapps\\common\\Skyrim Special Edition\\Data' }).errors[0]).toMatch(/Data folder/)
    expect(isGameData('C:\\Games\\Skyrim Special Edition', base.gameDirs)).toBe(false) // the game root itself is not Data
    expect(isGameData(ROOT, base.gameDirs)).toBe(false)
  })
  it('refuses unsafe SWF names, relative targets and bad mod ids', () => {
    expect(planDeploy({ ...base, swfs: [{ name: '..\\..\\evil', orphaned: false, kind: 'customMenu' }] }).errors.join()).toMatch(/unsafe path/)
    expect(planDeploy({ ...base, swfs: [{ name: 'a/b', orphaned: false, kind: 'customMenu' }] }).files).toEqual([{ rel: 'Interface/a/b.swf', swf: 'a/b' }]) // a nested path is still inside; the guard is about escaping
    expect(planDeploy({ ...base, swfs: [{ name: 'C:evil', orphaned: false, kind: 'customMenu' }] }).errors.join()).toMatch(/unsafe/)
    expect(planDeploy({ ...base, swfs: [hud], root: 'relative\\dir' }).errors[0]).toMatch(/absolute/)
    expect(planDeploy({ ...base, swfs: [hud], modId: '../x' }).errors.join()).toMatch(/mod id/)
    expect(planDeploy({ ...base, swfs: [{ name: 'my hud', orphaned: false, kind: 'hudWidget' }] }).errors.join()).toMatch(/widget script/)
  })
  it('a second widget shares the plugin (warned); no SWFs is an error', () => {
    const p = planDeploy({ ...base, swfs: [hud, { name: 'hud2', orphaned: false, kind: 'hudWidget' }] })
    expect(p.files.filter((f) => f.rel.endsWith('.esp'))).toHaveLength(1)
    expect(p.lint.map((l) => l.code)).toContain('widget-esp-shared')
    expect(planDeploy({ ...base, swfs: [] }).errors[0]).toMatch(/no SWF/)
  })
})

describe('safeJoin', () => {
  it('stays inside the root', () => {
    expect(safeJoin('C:\\mods\\a', 'Interface/x.swf').toLowerCase()).toBe('c:\\mods\\a\\interface\\x.swf')
    for (const bad of ['../x', 'a/../../x', '/abs', 'C:\\x', 'a//b', '', 'a/b?.swf', 'a\\..\\..\\b', 'dir./x']) expect(() => safeJoin('C:\\mods\\a', bad), bad).toThrow()
  })
})

describe('targets', () => {
  const s = (o: Record<string, string>) => resolveSettings(o, {})
  const proj = { name: 'My Mod', modId: 'MyMod' }
  it('MO2 mod folder = mods dir + mod name (default: project name); overwrite folder as set', () => {
    expect(resolveTarget('mo2Mod', s({ mo2ModsDir: 'C:\\MO2\\mods' }), proj)).toEqual({ root: 'C:\\MO2\\mods\\My Mod' })
    expect(resolveTarget('mo2Mod', s({ mo2ModsDir: 'C:\\MO2\\mods', mo2ModName: 'Other' }), proj)).toEqual({ root: 'C:\\MO2\\mods\\Other' })
    expect(resolveTarget('mo2Overwrite', s({ mo2OverwriteDir: 'C:\\MO2\\overwrite' }), proj)).toEqual({ root: 'C:\\MO2\\overwrite' })
  })
  it('errors: missing settings, mod names with separators; project deploy path is the fallback', () => {
    expect(resolveTarget('mo2Mod', s({}), proj)).toHaveProperty('error')
    expect(resolveTarget('mo2Overwrite', s({}), proj)).toHaveProperty('error')
    expect(resolveTarget('mo2Mod', s({ mo2ModsDir: 'C:\\m', mo2ModName: '..\\x' }), proj)).toHaveProperty('error')
    expect(resolveTarget('mo2Mod', s({}), { ...proj, deploy: { preset: 'mo2', path: 'C:\\M\\mods\\Test' } })).toEqual({ root: 'C:\\M\\mods\\Test' })
  })
  it('the list shows exact paths; Vortex and Package save a zip, by default in <project>/dist', () => {
    const l = targetList(s({ mo2ModsDir: 'C:\\MO2\\mods' }), { ...proj, dir: 'D:\\Proj\\A' }, () => false)
    expect(l.map((t) => [t.id, t.path ?? null, t.disabledReason ? true : false])).toEqual([['mo2Mod', 'C:\\MO2\\mods\\My Mod', false], ['mo2Overwrite', null, true], ['vortex', 'D:\\Proj\\A\\dist', false], ['package', 'D:\\Proj\\A\\dist', false]])
    expect(resolveTarget('vortex', s({}), proj)).toHaveProperty('error') // no project folder
  })
  it('package file name is <Name>-<version>.zip without characters Windows forbids', () => {
    expect(packageFileName('My Mod', '0.1.0')).toBe('My Mod-0.1.0.zip')
    expect(packageFileName('a/b:c*', '1.0 ')).toBe('a_b_c_-1.0.zip')
    expect(packageFileName('...', '')).toBe('mod-0.zip')
  })
})

describe('confirmation state', () => {
  it('is remembered per project and per exact folder, case-insensitively', () => {
    let st = {}
    expect(isConfirmed(st, 'D:\\Proj\\A', ROOT)).toBe(false)
    st = withConfirmed(st, 'D:\\Proj\\A', ROOT)
    expect(isConfirmed(st, 'd:\\proj\\a', ROOT.toLowerCase())).toBe(true)
    expect(isConfirmed(st, 'D:\\Proj\\B', ROOT)).toBe(false) // another project asks again
    expect(isConfirmed(st, 'D:\\Proj\\A', 'C:\\Modding\\MO2\\mods\\Other')).toBe(false) // another folder asks again
    expect(withConfirmed(st, 'D:\\Proj\\A', ROOT)).toBe(st) // idempotent
  })
})
