import { contextBridge, ipcRenderer } from 'electron'
import type { SyncUiState } from '../shared/syncState'

contextBridge.exposeInMainWorld('inkwell', {
  getSync: (): Promise<SyncUiState> => ipcRenderer.invoke('sync:get'),
  onSync: (cb: (s: SyncUiState) => void): (() => void) => {
    const h = (_e: unknown, s: SyncUiState): void => cb(s)
    ipcRenderer.on('sync:update', h)
    return () => ipcRenderer.removeListener('sync:update', h)
  }
})
