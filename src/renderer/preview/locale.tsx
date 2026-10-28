import { useSyncExternalStore } from 'react'
import { entriesFor, pseudoLocalize, type Localization } from '@inkwell-ui/spec'
import { useLocalizationStore } from '../state/localizationStore'
import { strings } from '../strings'
import { previewBus } from './previewBus'
import { Languages } from 'lucide-react'

// The preview's Locale and Pseudo-Loc (SPEC-CHANGES V4, V11.2): the menu class asks the mock bridge `translate(key)`, which answers from the mock data keys `tr.<$KEY>`.
// Module-level like uiScale, so the toolbar and the preview panel's "re-apply after a rebuild" effect share one state. Only keyed texts change; a layer without a key is the source text.
let language = '' // '' = the source language, as the compiled SWF has it
let pseudo = false
const subs = new Set<() => void>()
const snapshot = (): string => `${language}|${pseudo}`

/** What the mock bridge answers: key -> text. A key with no change answers with the key itself (the glue then keeps the compiled source text). Pure. */
export function previewTranslations(loc: Localization, lang: string, pseudoOn: boolean): Record<string, string> {
  const texts = lang && lang !== loc.source ? entriesFor(loc, lang).entries : Object.fromEntries(Object.entries(loc.entries).map(([k, row]) => [k, row[loc.source] ?? '']))
  // source language: the source text, so a graph's Set Text of a key shows it (a keyed layer keeps its compiled text either way); the key when the cell is empty
  return Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, lang || pseudoOn ? (pseudoOn ? pseudoLocalize(v) : v) : v || k]))
}

export const localeStore = {
  get: (): { language: string; pseudo: boolean } => ({ language, pseudo }),
  subscribe: (cb: () => void): (() => void) => (subs.add(cb), () => void subs.delete(cb)),
  /** Sets the mock answers in the running movie and reopens the menu so `begin()` translates again (false = nothing is running). */
  apply(loc: Localization | null, reopen = true): boolean {
    if (!loc) return false
    for (const [k, v] of Object.entries(previewTranslations(loc, language, pseudo))) previewBus.call('inkwellMock', `tr.${k}`, v)
    return reopen ? previewBus.call('inkwellMenuReopen') : true
  },
  set(next: { language?: string; pseudo?: boolean }, loc: Localization | null): void {
    if (next.language !== undefined) language = next.language
    if (next.pseudo !== undefined) pseudo = next.pseudo
    subs.forEach((cb) => cb())
    localeStore.apply(loc)
  },
  /** After a rebuild restarted the movie (and mock data was delivered): only a changed locale needs applying. */
  reapply(loc: Localization | null): void {
    localeStore.apply(loc, !!(language || pseudo)) // the source answers too (graph Set Text of a key), but only a changed locale reopens the menu
  },
  reset(): void {
    language = ''
    pseudo = false
    subs.forEach((cb) => cb())
  }
}

export const useLocale = (): { language: string; pseudo: boolean } => {
  useSyncExternalStore(localeStore.subscribe, snapshot)
  return localeStore.get()
}

const PSEUDO = 'pseudo'
const CODES: Record<string, string> = { ENGLISH: 'EN', FRENCH: 'FR', GERMAN: 'DE', ITALIAN: 'IT', SPANISH: 'ES', RUSSIAN: 'RU', POLISH: 'PL', JAPANESE: 'JA', CZECH: 'CS' }
/** The two-letter code of a Skyrim language name (ENGLISH -> EN); a name we do not know shows its first two letters. */
export const languageCode = (language: string): string => CODES[language] ?? language.slice(0, 2)

/** Language select of the stage toolbar (custom menus only: a HUD widget has no runtime to translate). Pseudo-localized text is an entry of the list, not a toggle on top of a language. */
export function LocaleControls() {
  const loc = useLocalizationStore((s) => s.localization)
  const { language: lang, pseudo: p } = useLocale()
  const none = !loc
  return (
    <label className="inline select-icon" title={none ? strings.stage.localeNoTable : strings.stage.locale}>
      <Languages size={14} aria-hidden="true" /> <span className="sr-only">{strings.stage.locale}</span>
      <select value={p ? PSEUDO : lang} disabled={none} onChange={(e) => localeStore.set(e.target.value === PSEUDO ? { language: '', pseudo: true } : { language: e.target.value, pseudo: false }, loc)} aria-label={strings.stage.locale} data-testid="stage-locale">
        <option value="" title={loc?.source}>{languageCode(loc?.source ?? 'ENGLISH')}</option>
        {(loc?.languages ?? []).filter((l) => l !== loc?.source).map((l) => <option key={l} value={l} title={l}>{languageCode(l)}</option>)}
      </select>
    </label>
  )
}
