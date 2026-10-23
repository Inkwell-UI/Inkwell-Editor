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
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({ mirrorFigma: true, setMirrorFigma: (mirrorFigma) => set({ mirrorFigma }) }),
    {
      name: 'inkwell.settings.v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ mirrorFigma: s.mirrorFigma }),
      merge: (p, cur) => ({ ...cur, mirrorFigma: typeof (p as { mirrorFigma?: unknown } | null)?.mirrorFigma === 'boolean' ? (p as { mirrorFigma: boolean }).mirrorFigma : cur.mirrorFigma })
    }
  )
)
