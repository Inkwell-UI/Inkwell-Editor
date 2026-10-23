import type { SyncUiState } from '../../shared/syncState'
import { useSyncStore } from '../state/syncStore'

/** Live sync/build state from the main process (undefined until the first answer). Fed by the bridge; any panel may call this. */
export function useSyncState(): SyncUiState | undefined {
  return useSyncStore((s) => s.sync)
}
