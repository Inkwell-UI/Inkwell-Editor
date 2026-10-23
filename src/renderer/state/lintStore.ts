import { create } from 'zustand'
import type { Severity } from '../../shared/lint'

/**
 * Display state of the Lint dock (the data itself is the main process's single validation source, merged by `model/lintRows.ts`).
 * API: `severity` filter, `currentSwfOnly`, `setSeverity`, `setCurrentSwfOnly`, `showAll()` (resets both filters so a jump target is visible).
 */
export interface LintStore {
  severity: 'all' | Severity
  currentSwfOnly: boolean
  setSeverity(s: 'all' | Severity): void
  setCurrentSwfOnly(on: boolean): void
  showAll(): void
}

export const useLintStore = create<LintStore>()((set) => ({
  severity: 'all',
  currentSwfOnly: false,
  setSeverity: (severity) => set({ severity }),
  setCurrentSwfOnly: (currentSwfOnly) => set({ currentSwfOnly }),
  showAll: () => set({ severity: 'all', currentSwfOnly: false })
}))
