import { create } from 'zustand'
import type { SyncUiState } from '../../shared/syncState'

/** The latest sync/build state from main (one subscription in the bridge; every panel reads it through `useSyncState()`). */
export interface SyncStore {
  sync: SyncUiState | undefined
  set(s: SyncUiState): void
}
export const useSyncStore = create<SyncStore>()((set) => ({ sync: undefined, set: (sync) => set({ sync }) }))
