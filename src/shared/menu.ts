import {
  effectiveInputContext, HOTKEY_RANGE, MENU_NAME, MENU_SLOTS, MENU_WARN_THRESHOLD, MenuDef, MenuSettings, MOD_EVENT_NAME, SPEC_VERSION, writeDefaultModIni, type UserDefaults
} from '@inkwell-ui/spec'
import type { DeployLintItem } from './deploy'
import { minRuntimeFor } from './runtimeFeatures'

// The custom-menu target (docs/menus.md): names and paths derived from the project, the MenuDef the runtime reads, the commented default INI and the
// lint codes of the export gate. Pure: the main process deploys with it, the Menu settings panel validates with it.

/** O2 (owner decision 2026-10-26, unverified in game): where a menu SWF goes. THE one place to change if the engine refuses a sub-path; the fallback is `Interface/<modId>_<Swf>.swf`. */
export const menuSwfPath = (modId: string, swfFile: string): string => `Interface/Inkwell/${modId}/${swfFile}.swf`
/** The O2 fallback layout (S9): the menu SWF flat under `Interface/` as `<menuName>.swf`. Returns the settings with `swf` set so the planner, the gate and the JSON all see it (the deploy script's `--flat`). */
export const flatMenuSettings = (modId: string, swfFolder: string, s: MenuSettings): MenuSettings => ({ ...s, swf: `Interface/${resolveMenuNames(modId, { swf: swfFolder, settings: s }).name}.swf` })
export const MENU_JSON_DIR = 'SKSE/Plugins/Inkwell/menus'
export const MOD_INI_DIR = 'SKSE/Plugins/Inkwell'
export const menuJsonPath = (menuName: string): string => `${MENU_JSON_DIR}/${menuName}.json`
export const modIniPath = (modId: string): string => `${MOD_INI_DIR}/${modId}.ini`

/** What a plain `MenuSettings` of a new menu holds (every default of the Spec schema, current spec version). */
export const defaultMenuSettings = (): MenuSettings => MenuSettings.parse({ specVersion: SPEC_VERSION })

/** SWF folder name -> the file/class stem of the menu: letters, digits and `_`, a capital first letter (`main-menu` -> `Main_menu`). */
export function menuSwfName(swfName: string): string {
  const s = swfName.replace(/[^A-Za-z0-9_]/g, '_')
  const t = /^[A-Za-z]/.test(s) ? s : `M${s}`
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export interface MenuSource {
  /** SWF folder name under `swfs/`. */
  swf: string
  settings: MenuSettings
  /** Runtime features the SWF uses (`RuntimeFeature` names); absent = only the base menu. */
  features?: readonly string[]
}

/** The mod name of the translation files (V13.2): set in the menu JSON when the SWF has translated text. */
export const menuTranslations = (modId: string, m: MenuSource): string | undefined => (m.features?.includes('translation') ? modId : undefined)

/** Engine menu name (S1): the author's `name`, else `<modId>_<SwfName>`; and the SWF path, the author's `swf`, else the O2 path. */
export function resolveMenuNames(modId: string, m: MenuSource): { name: string; swf: string; file: string } {
  const file = menuSwfName(m.swf)
  return { name: m.settings.name ?? `${modId}_${file}`, swf: m.settings.swf ?? menuSwfPath(modId, file), file }
}

/** The highest Inkwell Runtime version what the SWF uses needs (S3 rule 1). Every 0.3 feature is in the first runtime. */
export const minRuntimeOf = (m: MenuSource): string => minRuntimeFor(['menu', ...(m.features ?? [])])

export type MenuProblem = { code: string; message: string }

/** The deployed `MenuDef` (S1) of one menu, or what is wrong with it. Validation is the Spec schema; the codes are the S9 lint codes. */
export function buildMenuDef(modId: string, m: MenuSource): { def: MenuDef; problems: [] } | { def?: undefined; problems: MenuProblem[] } {
  const r = resolveMenuNames(modId, m)
  const s = m.settings
  const problems: MenuProblem[] = []
  if (!MENU_NAME.test(r.name)) problems.push({ code: 'menu-name-invalid', message: `Menu name "${r.name}" must match ${MENU_NAME} (letters, digits and _, starting with a letter, 2 to 64 characters).` })
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(r.name)) problems.push({ code: 'menu-name-invalid', message: `Menu name "${r.name}" is a reserved Windows device name (the menu JSON would be named after it). Pick another name.` })
  const hk = s.triggers.hotkey
  if (hk !== undefined && !(Number.isInteger(hk) && hk >= HOTKEY_RANGE.min && hk <= HOTKEY_RANGE.max)) problems.push({ code: 'menu-hotkey-invalid', message: `Open key ${hk} must be a DirectInput scan code from ${HOTKEY_RANGE.min} to ${HOTKEY_RANGE.max} (1 is Escape).` })
  const me = s.triggers.modEvent
  if (me !== undefined && !MOD_EVENT_NAME.test(me)) problems.push({ code: 'menu-event-invalid', message: `Mod event name "${me}" must match ${MOD_EVENT_NAME}.` })
  if (problems.length) return { problems }
  // userDefaults and the author-only keys never reach the deployed JSON; unknown keys of the source are not part of the runtime's file either
  const parsed = MenuDef.safeParse({
    specVersion: SPEC_VERSION, name: r.name, swf: r.swf, minRuntime: minRuntimeOf(m), flags: s.flags, inputContext: effectiveInputContext(s), depth: s.depth, triggers: s.triggers,
    ...(menuTranslations(modId, m) ? { translations: menuTranslations(modId, m) } : {})
  })
  if (!parsed.success) return { problems: parsed.error.issues.map((i) => ({ code: i.path[0] === 'swf' ? 'menu-swf-invalid' : 'menu-invalid', message: `${i.path.join('.') || 'menu'}: ${i.message}` })) }
  return { def: parsed.data, problems: [] }
}

/** Export-gate lint of the project's menus (S9). `menus` is every non-orphaned customMenu SWF of the project; `swf` on a row is its folder name. */
export function menuLint(modId: string, menus: readonly MenuSource[]): DeployLintItem[] {
  const out: DeployLintItem[] = []
  const seen = new Map<string, string>()
  for (const m of menus) {
    const r = resolveMenuNames(modId, m)
    for (const p of buildMenuDef(modId, m).problems) out.push({ severity: 'error', code: p.code, message: `"${m.swf}": ${p.message}`, swf: m.swf })
    const first = seen.get(r.name.toLowerCase())
    if (first !== undefined) out.push({ severity: 'error', code: 'menu-name-duplicate', message: `"${m.swf}": the menu name "${r.name}" is already used by "${first}" (names are unique, ignoring case).`, swf: m.swf })
    else seen.set(r.name.toLowerCase(), m.swf)
    // S-A (owner, 2026-10-27): the pad reaches a menu only in menuMode, so a focus graph needs it
    if (m.features?.includes('focusGraph') && effectiveInputContext({ inputContext: m.settings.inputContext, flags: m.settings.flags }) !== 'menuMode')
      out.push({ severity: 'error', code: 'focus-input-context', message: `"${m.swf}" has a gamepad focus graph, but its Input Context is None: the pad reaches a menu only in MenuMode. Set Input Context to MenuMode (or make the menu modal).`, swf: m.swf })
  }
  if (menus.length > MENU_SLOTS)
    out.push({ severity: 'error', code: 'menu-limit', message: `The project has ${menus.length} custom menus; the runtime has ${MENU_SLOTS} slots in total, shared by every installed mod.` })
  else if (menus.length > MENU_WARN_THRESHOLD)
    out.push({ severity: 'warning', code: 'menu-limit', message: `The project has ${menus.length} custom menus. The runtime has ${MENU_SLOTS} slots shared by every installed mod, so more than ${MENU_WARN_THRESHOLD} menus may not all register.` })
  return out
}

/** The commented default `<modId>.ini` (Spec `writeDefaultModIni`) of the menus whose names are valid; an invalid menu is reported by `menuLint` and blocks the export. */
export function modIniText(modName: string, modId: string, menus: readonly MenuSource[]): string {
  return writeDefaultModIni({
    modName, modId,
    menus: menus.map((m) => ({ name: resolveMenuNames(modId, m).name, ...(m.settings.triggers.hotkey !== undefined ? { hotkey: m.settings.triggers.hotkey } : {}), ...(m.settings.userDefaults ? { userDefaults: m.settings.userDefaults as UserDefaults } : {}) }))
  })
}
