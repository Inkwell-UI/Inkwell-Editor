import { create } from 'zustand'
import { addBuild, attachPreview, type BuildRecord } from '../model/timingHistory'

/** The last 50 builds, in memory (the status bar's timing history popover). API: `history` (oldest first), `record(rec)`, `setPreviewMs(seq, ms)`. */
export interface TimingStore {
  history: BuildRecord[]
  record(rec: BuildRecord): void
  setPreviewMs(seq: number, ms: number): void
}

export const useTimingStore = create<TimingStore>()((set) => ({
  history: [],
  record: (rec) => set((s) => ({ history: addBuild(s.history, rec) })),
  setPreviewMs: (seq, ms) => set((s) => ({ history: attachPreview(s.history, seq, ms) }))
}))
