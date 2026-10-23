import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type InkwellApi } from '../shared/ipc'

const on = <T>(channel: string, cb: (v: T) => void): (() => void) => {
  const h = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api: InkwellApi = {
  getSync: () => ipcRenderer.invoke(IPC.syncGet),
  onSync: (cb) => on(IPC.syncUpdate, cb),
  getPreviewBuilds: () => ipcRenderer.invoke(IPC.previewGet),
  onPreviewBuild: (cb) => on(IPC.previewBuild, cb),
  getPreviewFonts: () => ipcRenderer.invoke(IPC.previewFonts),
  reportPreviewRendered: (r) => ipcRenderer.send(IPC.previewRendered, r)
}
contextBridge.exposeInMainWorld('inkwell', api)
