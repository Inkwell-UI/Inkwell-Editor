import { isAbsolute, join, resolve, sep } from 'node:path'
import { FIRST_RUNTIME_VERSION, MENU_NAME, type MenuSettings } from '@inkwell-ui/spec'
import { defaultMenuSettings, menuJsonPath, modIniPath, resolveMenuNames } from '../../shared/menu'
import type { ResolvedSettings, StoredSettings } from '../../shared/doctor'
import type { DeployLintItem, DeployTargetId, DeployTargetInfo } from '../../shared/deploy'
import { isPapyrusName } from '../widget/papyrus'
import { isInside } from '../vanilla/cache'

// Pure deploy decisions: where a target points, what files a project produces there, and the guards that keep every write inside the chosen folder.

/** Paths that look like a game Data folder even when the Skyrim install was not detected (the same rule as scripts/deploy-widget.ts). */
const GAME_DATA = /[\\/]skyrim[^\\/]*[\\/]data([\\/]|$)/i

/** True when `root` is inside the game's `Data` folder (known game folders, plus the name pattern as a safety net). */
export function isGameData(root: string, gameDirs: string[]): boolean {
  return GAME_DATA.test(root) || gameDirs.some((g) => isInside(root, join(g, 'Data')))
}

/** Joins `rel` under `root` or throws: no absolute paths, no drive letters, no `..`, no empty parts, no reserved characters. */
export function safeJoin(root: string, rel: string): string {
  if (!rel || isAbsolute(rel) || /^[a-z]:/i.test(rel) || /[<>:"|?*\0]/.test(rel) || rel.split(/[\\/]/).some((p) => p === '' || p === '.' || p === '..' || /[. ]$/.test(p)))
    throw new Error(`Refusing unsafe path "${rel}".`)
  const full = resolve(root, ...rel.split(/[\\/]/))
  if (!full.toLowerCase().startsWith(resolve(root).toLowerCase() + sep)) throw new Error(`"${rel}" would leave the target folder.`)
  return full
}

export interface ProjectLike {
  /** Project folder; package targets default to `<dir>/dist`. */
  dir?: string
  name: string
  modId: string
  deploy?: { preset: string; path: string }
}
export interface SwfLike {
  name: string
  orphaned: boolean
  kind: 'hudWidget' | 'customMenu' | 'menuReplacement'
  /** customMenu: `swfs/<name>/menu.json` (absent = the defaults). */
  menu?: MenuSettings
}

/** Folder a target writes to, or the reason it has none. A leaf name (mod name) may not contain separators. */
export function resolveTarget(id: DeployTargetId, s: Pick<ResolvedSettings, 'mo2ModsDir' | 'mo2OverwriteDir' | 'mo2ModName'>, p: ProjectLike): { root: string } | { error: string } {
  if (id === 'package' || id === 'vortex') return p.dir ? { root: packageDir(p.dir) } : { error: 'No project is open.' }
  if (id === 'mo2Overwrite') return s.mo2OverwriteDir ? { root: resolve(s.mo2OverwriteDir) } : { error: 'Set the MO2 overwrite folder in Settings.' }
  if (s.mo2ModsDir) {
    const mod = s.mo2ModName || p.name
    if (!mod.trim() || /[\\/:*?"<>|]/.test(mod) || mod === '.' || mod === '..') return { error: `"${mod}" is not a valid mod folder name.` }
    return { root: resolve(s.mo2ModsDir, mod.trim()) }
  }
  if (p.deploy?.preset === 'mo2' && p.deploy.path) return { root: resolve(p.deploy.path) }
  return { error: 'Set the MO2 mods directory in Settings.' }
}

export function targetList(s: ResolvedSettings, p: ProjectLike, confirmed: (root: string) => boolean): DeployTargetInfo[] {
  const t = (id: DeployTargetId, label: string): DeployTargetInfo => {
    const r = resolveTarget(id, s, p)
    return 'root' in r ? { id, label, path: r.root, confirmed: confirmed(r.root) } : { id, label, disabledReason: r.error }
  }
  // Vortex has no folder Inkwell may write into (its staging folder is Vortex's own state), so the Vortex target saves the same zip as Package Mod
  return [t('mo2Mod', 'MO2 mod folder'), t('mo2Overwrite', 'MO2 overwrite folder'), t('vortex', 'Vortex (zip to install)'), t('package', 'Package Mod (zip)')]
}

/** Default folder for packages (git-ignored in new projects and the samples). */
export const packageDir = (projectDir: string): string => join(projectDir, 'dist')

/** `<Name>-<version>.zip` with characters Windows forbids in file names replaced by `_`. */
export function packageFileName(name: string, version: string): string {
  const clean = (s: string): string => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().replace(/[. ]+$/, '')
  return `${clean(name) || 'mod'}-${clean(version) || '0'}.zip`
}

export interface PlannedFile {
  rel: string
  swf: string
}
export interface DeployPlan {
  root: string
  files: PlannedFile[]
  lint: DeployLintItem[]
  notes: string[]
  /** Refusals. A plan with errors must not be written. */
  errors: string[]
  /** Per hudWidget SWF: the widget name used for the script and SWF file names. */
  widgets: Record<string, string>
}

/** The deploy dialog's line for menu mods (UX 5.1, S3 rule 6). */
export const RUNTIME_NOTE = 'Requires Inkwell Runtime'
export const RUNTIME_NOTE_TEXT = `${RUNTIME_NOTE} ${FIRST_RUNTIME_VERSION} or newer; not included in this deploy.`

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * project + settings -> the files a deploy writes. Layout (design spec "Menus, contracts and SkyUI"):
 * hudWidget -> Interface/exported/widgets/<modId>/<Widget>.swf, Scripts/*.pex (only with a Papyrus compiler), Source/Scripts/*.psc, <modId>.esp (once);
 * customMenu -> Interface/Inkwell/<modId>/<Swf>.swf (O2, `menuSwfPath`), SKSE/Plugins/Inkwell/menus/<menu>.json, and once per mod the commented default
 * SKSE/Plugins/Inkwell/<modId>.ini (created if absent, never overwritten; docs/menus.md); menuReplacement is not deployed.
 */
export function planDeploy(o: { modId: string; swfs: SwfLike[]; root: string; gameDirs: string[]; hasPapyrus: boolean; only?: string }): DeployPlan {
  const plan: DeployPlan = { root: o.root, files: [], lint: [], notes: [], errors: [], widgets: {} }
  if (!isAbsolute(o.root)) plan.errors.push(`The target folder "${o.root}" is not an absolute path.`)
  if (isGameData(o.root, o.gameDirs)) plan.errors.push(`Refusing to deploy into the game's Data folder (${o.root}). Deploy to an MO2 mod folder or the overwrite folder; MO2's virtual file system puts the files in the game.`)
  if (!o.modId || !isPapyrusName(o.modId)) plan.errors.push(`The mod id "${o.modId}" is not usable for file and script names.`)
  const swfs = o.swfs.filter((s) => !s.orphaned && (!o.only || s.name === o.only))
  if (swfs.length === 0) plan.errors.push(o.only ? `The SWF "${o.only}" cannot be deployed (missing or orphaned).` : 'The project has no SWF to deploy.')
  let espDone = false
  let iniDone = false
  for (const s of swfs) {
    const add = (rel: string): void => void plan.files.push({ rel, swf: s.name })
    if (s.kind === 'hudWidget') {
      const w = cap(s.name)
      if (!isPapyrusName(w)) {
        plan.errors.push(`The SWF name "${s.name}" cannot name a widget script (letters and digits only, starting with a letter).`)
        continue
      }
      plan.widgets[s.name] = w
      add(`Interface/exported/widgets/${o.modId}/${w}.swf`)
      add(`Source/Scripts/${o.modId}_${w}.psc`)
      add(`Source/Scripts/${o.modId}_${w}Instance.psc`)
      if (o.hasPapyrus) {
        add(`Scripts/${o.modId}_${w}.pex`)
        add(`Scripts/${o.modId}_${w}Instance.pex`)
      } else plan.lint.push({ severity: 'warning', code: 'papyrus-compiler-missing', message: `No Papyrus compiler is set: "${s.name}" is deployed as a SWF only, without scripts or plugin. Set INKWELL_PAPYRUS or the compiler path in Settings.` })
      if (!espDone && o.hasPapyrus) {
        add(`${o.modId}.esp`)
        espDone = true
      } else if (espDone) plan.lint.push({ severity: 'warning', code: 'widget-esp-shared', message: `"${s.name}" shares ${o.modId}.esp with the first widget; only one plugin quest is generated per mod today.` })
    } else if (s.kind === 'customMenu') {
      const m = resolveMenuNames(o.modId, { swf: s.name, settings: s.menu ?? defaultMenuSettings() })
      add(m.swf)
      // an invalid or duplicate menu name is the export gate's `menu-name-invalid` / `menu-name-duplicate`, not a path clash
      if (MENU_NAME.test(m.name) && !plan.files.some((f) => f.rel.toLowerCase() === menuJsonPath(m.name).toLowerCase())) add(menuJsonPath(m.name))
      if (!iniDone) add(modIniPath(o.modId)), (iniDone = true)
      if (!plan.notes.some((n) => n.startsWith(RUNTIME_NOTE))) plan.notes.push(RUNTIME_NOTE_TEXT)
    } else plan.lint.push({ severity: 'warning', code: 'menu-replacement-skipped', message: `"${s.name}" is a menu replacement; replacements are not deployed yet.` })
  }
  for (const f of plan.files) {
    try {
      safeJoin(o.root, f.rel)
    } catch (e) {
      plan.errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  const seen = new Set<string>()
  for (const f of plan.files) {
    const k = f.rel.toLowerCase()
    if (seen.has(k)) plan.errors.push(`Two SWFs would write the same file: ${f.rel}.`)
    seen.add(k)
  }
  return plan
}

// --- confirmation state: the first deploy to a new folder asks, then it is remembered per project ---

const key = (projectDir: string): string => resolve(projectDir).toLowerCase()
const same = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase()

export const isConfirmed = (s: StoredSettings, projectDir: string, root: string): boolean => (s.deployConfirmed?.[key(projectDir)] ?? []).some((r) => same(r, root))
export function withConfirmed(s: StoredSettings, projectDir: string, root: string): StoredSettings {
  if (isConfirmed(s, projectDir, root)) return s
  const cur = s.deployConfirmed ?? {}
  return { ...s, deployConfirmed: { ...cur, [key(projectDir)]: [...(cur[key(projectDir)] ?? []), resolve(root)] } }
}
