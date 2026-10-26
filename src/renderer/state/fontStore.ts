import { create } from 'zustand'
import type { ProjectFontInfo } from '../../shared/fonts'
import { inkwell } from '../hooks/api'
import { strings } from '../strings'
import { useToastStore } from './toastStore'

/**
 * The project's embedded custom fonts (SPEC-CHANGES V5, `fonts.json`): the list the Inspector's Embedded font field offers, with the licence verdict of each.
 * `load()` runs when a project opens; `add()` opens the file dialog in main; `saveSettings()` changes the charsets and extra characters (main rebuilds the SWFs).
 */
export interface FontStore {
  loaded: boolean
  fonts: ProjectFontInfo[]
  error: string | undefined
  load(): Promise<void>
  /** Returns the added (or already present) font's hash, undefined when cancelled or failed (a toast says why). */
  add(): Promise<string | undefined>
  saveSettings(hash: string, settings: { charsets: string[]; extraChars: string }): void
}

const toast = (t: Parameters<ReturnType<typeof useToastStore.getState>['push']>[0]): void => useToastStore.getState().push(t)

export const useFontStore = create<FontStore>()((set, get) => ({
  loaded: false,
  fonts: [],
  error: undefined,
  async load() {
    const s = await inkwell?.getProjectFonts()
    if (s) set({ loaded: true, fonts: s.fonts, error: s.error })
  },
  async add() {
    const r = await inkwell?.addProjectFont()
    if (!r || (!r.ok && r.cancelled)) return undefined
    if (!r.ok) return void toast({ tone: 'error', title: r.error })
    await get().load()
    const f = r.font
    toast(
      f.license.level === 'error' ? { tone: 'error', title: strings.insp.embeddedFont.addedBlocked(f.family), text: f.license.text }
        : f.license.level === 'warning' ? { tone: 'info', title: strings.insp.embeddedFont.added(f.family), text: `${f.license.text}. ${strings.insp.embeddedFont.notice}` }
          : { tone: 'ok', title: r.existed ? strings.insp.embeddedFont.existed(f.family) : strings.insp.embeddedFont.added(f.family), text: strings.insp.embeddedFont.notice }
    )
    return f.hash
  },
  saveSettings(hash, settings) {
    set({ fonts: get().fonts.map((f) => (f.hash === hash ? { ...f, ...settings } : f)) })
    void inkwell?.saveProjectFontSettings(hash, settings).then((r) => {
      if (!r.ok) toast({ tone: 'error', title: r.error })
    })
  }
}))
