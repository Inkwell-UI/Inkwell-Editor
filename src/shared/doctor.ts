/** Setup Doctor and settings types shared by main, preload and renderer. */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skipped'
export type CheckId = 'java' | 'ffdec' | 'wrapper' | 'papyrus' | 'skyrim' | 'vanilla' | 'projectIgnore' | 'figma' | 'mo2'

/** Settings the user can point at a path. Environment variables (INKWELL_*) override them. */
export type PathSettingKey = 'ffdecDir' | 'javaPath' | 'papyrusExe' | 'creationKitSources' | 'skyrimPath' | 'figmaManifest' | 'mo2ModsDir' | 'mo2OverwriteDir'
export type TextSettingKey = 'mo2ModName'
export type SettingKey = PathSettingKey | TextSettingKey

export type FixAction =
  | { kind: 'browse'; setting: PathSettingKey; folder: boolean }
  | { kind: 'clear'; setting: SettingKey }
  | { kind: 'copy'; text: string }
  | { kind: 'open'; url: string }
  | { kind: 'run'; task: 'benchmark' | 'buildVanillaCache' }
export interface Fix {
  label: string
  action: FixAction
}

export interface CheckResult {
  id: CheckId
  label: string
  status: CheckStatus
  detail: string
  fix?: Fix
  /** More actions for the same row (for example Browse next to Copy). */
  extra?: Fix[]
  /** What the check found on its own when the setting is empty (Steam path, default manifest), shown in the row's field. */
  found?: { value: string; source: 'detected' | 'default' }
}

/** Settings each row edits, in order (the rows show one input per entry). */
export const ROW_SETTINGS: Partial<Record<CheckId, { key: SettingKey; folder: boolean }[]>> = {
  java: [{ key: 'javaPath', folder: false }],
  ffdec: [{ key: 'ffdecDir', folder: true }],
  papyrus: [{ key: 'papyrusExe', folder: false }, { key: 'creationKitSources', folder: true }],
  skyrim: [{ key: 'skyrimPath', folder: true }],
  figma: [{ key: 'figmaManifest', folder: false }],
  mo2: [{ key: 'mo2ModsDir', folder: true }, { key: 'mo2ModName', folder: false }, { key: 'mo2OverwriteDir', folder: true }]
}

/** The checks a changed setting can affect: only these are re-run (pure). */
export function checksForSetting(key: SettingKey): CheckId[] {
  switch (key) {
    case 'javaPath': return ['java']
    case 'ffdecDir': return ['ffdec']
    case 'papyrusExe': case 'creationKitSources': return ['papyrus']
    case 'skyrimPath': return ['skyrim', 'vanilla', 'mo2'] // the vanilla cache needs the archive; mo2 refuses targets inside Data
    case 'figmaManifest': return ['figma']
    default: return ['mo2']
  }
}

/** Replaces the rows of `fresh` in `old` (same ids), keeping order and every other row (pure). */
export function mergeResults(old: CheckResult[] | undefined, fresh: CheckResult[]): CheckResult[] {
  if (!old) return fresh
  const byId = new Map(fresh.map((r) => [r.id, r]))
  const merged = old.map((r) => byId.get(r.id) ?? r)
  return [...merged, ...fresh.filter((r) => !old.some((o) => o.id === r.id))]
}

/** Stored settings (`<userData>/settings.json`). Every field is optional; defaults live in `resolveSettings`. */
export interface StoredSettings extends Partial<Record<SettingKey, string>> {
  /** Project folder (lower case) -> deploy targets the user has confirmed once. */
  deployConfirmed?: Record<string, string[]>
  /** The first-launch Setup Doctor has been shown (or was not needed). */
  doctorSeen?: boolean
  /** SHA-256 (64 hex) of every Figma plugin secret the user approved. Never the secrets; never in a project. */
  figmaPlugins?: string[]
}

export type SettingSource = 'env' | 'settings' | 'default'
/** What the editor uses: stored value, overridden by the environment, else the default. `source` says which. */
export interface ResolvedSettings {
  ffdecDir: string
  javaPath: string
  papyrusExe?: string
  creationKitSources?: string
  skyrimPath?: string
  figmaManifest?: string
  mo2ModsDir?: string
  mo2OverwriteDir?: string
  mo2ModName?: string
  source: Partial<Record<SettingKey, SettingSource>>
  /** Why a value is not usable (does not exist, is a file not a folder, ...), by key. Filled by the session, not by `resolveSettings`. */
  problems?: Partial<Record<SettingKey, string>>
}

/** Result of storing a setting: never a bare rejection, so the UI can show the reason on the row. `cancelled`: the dialog was closed. */
export type SetSettingResult = { ok: true; settings: ResolvedSettings; cancelled?: boolean } | { ok: false; error: string }

export interface BenchmarkResult {
  ok: boolean
  error?: string
  /** Median of the cold CLI runs (shapes + script import, two processes), ms. */
  coldCliMs?: number
  coldRuns?: number
  /** First job of a fresh wrapper, including JVM start, ms. */
  firstJobMs?: number
  /** Median of the following warm jobs, ms. */
  warmMedianMs?: number
  warmRuns?: number
}

export interface BuildCacheResult {
  ok: boolean
  error?: string
  entries?: number
  bytes?: number
  path?: string
}
