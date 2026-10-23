import { useEffect, useState } from 'react'
import type { SyncUiState } from '../../shared/syncState'
import { inkwell } from './api'

/** Live sync/build state from the main process (undefined until the first answer). Any panel may call this; there is nothing to pass in. */
export function useSyncState(): SyncUiState | undefined {
  const [s, setS] = useState<SyncUiState>()
  useEffect(() => {
    void inkwell?.getSync().then(setS)
    return inkwell?.onSync(setS)
  }, [])
  return s
}
