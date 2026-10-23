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
  reportPreviewRendered: (r) => ipcRenderer.send(IPC.previewRendered, r),
  getProject: () => ipcRenderer.invoke(IPC.projectGet),
  onProject: (cb) => on(IPC.projectUpdate, cb),
  newProject: (t) => ipcRenderer.invoke(IPC.projectNew, t),
  openProject: (dir, t) => ipcRenderer.invoke(IPC.projectOpen, dir, t),
  openExample: (t) => ipcRenderer.invoke(IPC.projectExample, t),
  getRecentProjects: () => ipcRenderer.invoke(IPC.projectRecent),
  saveOverlay: (swfName, overlay) => ipcRenderer.invoke(IPC.overlaySave, swfName, overlay),
  setStrictMode: (on) => ipcRenderer.invoke(IPC.strictSet, on),
  buildAll: () => ipcRenderer.invoke(IPC.buildAll),
  setPreviewDetached: (d) => ipcRenderer.invoke(IPC.previewDetach, d),
  getPreviewDetached: () => ipcRenderer.invoke(IPC.previewDetached),
  onPreviewDetached: (cb) => on(IPC.previewDetached, cb),
  sendUiEvent: (e) => ipcRenderer.send(IPC.uiEvent, e),
  onUiEvent: (cb) => on(IPC.uiEvent, cb),
  onFigmaSelection: (cb) => on(IPC.figmaSelection, cb)
}
contextBridge.exposeInMainWorld('inkwell', api)
