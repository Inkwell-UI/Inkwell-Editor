import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { safeStorage } from './safeStorage'

/**
 * Per-user editor settings (renderer-side, localStorage behind `safeStorage`). API: `mirrorFigma` (Figma -> Inkwell selection mirroring,
 * UX 2.4; default on), `setMirrorFigma(on)`.
 */
export interface SettingsStore {
  mirrorFigma: boolean
  setMirrorFigma(on: boolean): void
  /** Tidy Layout hangs data-only nodes below one straight exec line (default on); off puts every node in a column by wire depth. */
  tidyHang: boolean
  setTidyHang(on: boolean): void
}

const bool = (p: unknown, key: string, fallback: boolean): boolean => {
  const v = (p as Record<string, unknown> | null)?.[key]
  return typeof v === 'boolean' ? v : fallback
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({ mirrorFigma: true, setMirrorFigma: (mirrorFigma) => set({ mirrorFigma }), tidyHang: true, setTidyHang: (tidyHang) => set({ tidyHang }) }),
    {
      name: 'inkwell.settings.v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ mirrorFigma: s.mirrorFigma, tidyHang: s.tidyHang }),
      merge: (p, cur) => ({ ...cur, mirrorFigma: bool(p, 'mirrorFigma', cur.mirrorFigma), tidyHang: bool(p, 'tidyHang', cur.tidyHang) })
    }
  )
)
