import { compareVersions, FIRST_RUNTIME_VERSION } from '@inkwell-ui/spec'

// The lowest Inkwell Runtime a custom menu needs (SPEC-CHANGES S3 rule 1): the highest `since` of the runtime features it uses. Every 0.3 feature is in the
// first runtime; `translation` needs 0.4.0. A later runtime feature gets a row here with its own version.
export const RUNTIME_FEATURE_SINCE = {
  menu: FIRST_RUNTIME_VERSION, // the menu glue, On Open/Close/Click/Focus/Input/Mod Event nodes, Game bridge nodes, UI scale and offset
  savedVariables: FIRST_RUNTIME_VERSION,
  list: FIRST_RUNTIME_VERSION,
  focusGraph: FIRST_RUNTIME_VERSION, // W3: needs only On Input (Up/Down/Left/Right) and menuMode, both in the first runtime
  systemMenu: '0.5.1', // `triggers.systemMenu`: the runtime adds the Journal System page entry
  translation: '0.4.0' // `inkwell.translate` / `inkwell.language` and the translation files the runtime reads itself (SPEC-CHANGES V13.2)
} as const
export type RuntimeFeature = keyof typeof RUNTIME_FEATURE_SINCE

/** Highest `since` among `features` (unknown names are ignored); at least the first runtime. */
export function minRuntimeFor(features: Iterable<string> = []): string {
  let best: string = FIRST_RUNTIME_VERSION
  for (const f of features) {
    const v = (RUNTIME_FEATURE_SINCE as Record<string, string | undefined>)[f]
    if (v && compareVersions(v, best) > 0) best = v
  }
  return best
}

/** Highest requirement of several menus (a project's menus share the one generated check). */
export const maxVersion = (versions: readonly string[]): string => versions.reduce((a, b) => (compareVersions(b, a) > 0 ? b : a), FIRST_RUNTIME_VERSION as string)
