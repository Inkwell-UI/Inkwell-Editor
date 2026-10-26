import { create } from 'zustand'
import { Localization, SPEC_VERSION } from '@inkwell-ui/spec'
import { inkwell } from '../hooks/api'
import { strings } from '../strings'
import { useToastStore } from './toastStore'

/**
 * `localization.json` in the renderer (SPEC-CHANGES V2.3). The table and the Inspector's key field edit it; every change is saved at once through IPC
 * (`saveLocalization`), like the Menu settings. `localization` null = no file yet; `error` = an unreadable file, which is never written.
 * `load()` runs when a project opens; a failed save keeps the edit on screen and says why.
 */
export interface LocalizationStore {
  loaded: boolean
  localization: Localization | null
  error: string | undefined
  modId: string
  load(): Promise<void>
  /** Replaces the table (an edit made by the pure ops of `shared/localizationOps`) and saves it. */
  set(next: Localization): void
  /** A new table for the project: namespace `Inkwell_<modId>`, English only. */
  create(): void
  reset(): void
}

export const defaultTable = (modId: string): Localization =>
  Localization.parse({ specVersion: SPEC_VERSION, namespace: `Inkwell_${modId.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 64), source: 'ENGLISH', languages: ['ENGLISH'], entries: {} })

export const useLocalizationStore = create<LocalizationStore>()((set, get) => ({
  loaded: false,
  localization: null,
  error: undefined,
  modId: '',
  async load() {
    const s = await inkwell?.getLocalization()
    if (s) set({ loaded: true, localization: s.localization, error: s.error, modId: s.modId })
  },
  set(next) {
    if (get().error) return
    set({ localization: next })
    void inkwell?.saveLocalization(next).then((r) => {
      if (!r.ok) useToastStore.getState().push({ tone: 'error', title: strings.loc.saveFailed(r.error) })
    })
  },
  create() {
    if (get().localization || get().error) return
    get().set(defaultTable(get().modId || 'Mod'))
  },
  reset: () => set({ loaded: false, localization: null, error: undefined, modId: '' })
}))
