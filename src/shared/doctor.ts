/** Setup Doctor and settings types shared by main, preload and renderer. */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skipped'
export type CheckId = 'java' | 'ffdec' | 'wrapper' | 'papyrus' | 'skyrim' | 'vanilla' | 'projectIgnore' | 'figma'

/** Settings the user can point at a path. Environment variables (INKWELL_*) override them. */
export type PathSettingKey = 'ffdecDir' | 'javaPath' | 'papyrusExe' | 'creationKitSources' | 'skyrimPath' | 'figmaManifest' | 'mo2ModsDir' | 'mo2OverwriteDir'
export type TextSettingKey = 'mo2ModName'
export type SettingKey = PathSettingKey | TextSettingKey

export type FixAction =
  | { kind: 'browse'; setting: PathSettingKey; folder: boolean }
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
}

/** Stored settings (`<userData>/settings.json`). Every field is optional; defaults live in `resolveSettings`. */
export interface StoredSettings extends Partial<Record<SettingKey, string>> {
  /** Project folder (lower case) -> deploy targets the user has confirmed once. */
  deployConfirmed?: Record<string, string[]>
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
}

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
