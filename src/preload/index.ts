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
  saveMenuSettings: (swfName, settings) => ipcRenderer.invoke(IPC.menuSave, swfName, settings),
  listGraphs: (swf) => ipcRenderer.invoke(IPC.graphsList, swf),
  loadGraph: (swf, id) => ipcRenderer.invoke(IPC.graphsLoad, swf, id),
  saveGraph: (swf, g) => ipcRenderer.invoke(IPC.graphsSave, swf, g),
  createGraph: (swf, name, scope) => ipcRenderer.invoke(IPC.graphsCreate, swf, name, scope),
  deleteGraph: (swf, id) => ipcRenderer.invoke(IPC.graphsDelete, swf, id),
  graphAs2: (swf, graph) => ipcRenderer.invoke(IPC.graphsAs2, swf, graph),
  getPacks: () => ipcRenderer.invoke(IPC.packsGet),
  setStrictMode: (on) => ipcRenderer.invoke(IPC.strictSet, on),
  buildAll: () => ipcRenderer.invoke(IPC.buildAll),
  setPreviewDetached: (d) => ipcRenderer.invoke(IPC.previewDetach, d),
  getPreviewDetached: () => ipcRenderer.invoke(IPC.previewDetached),
  onPreviewDetached: (cb) => on(IPC.previewDetached, cb),
  sendUiEvent: (e) => ipcRenderer.send(IPC.uiEvent, e),
  onUiEvent: (cb) => on(IPC.uiEvent, cb),
  onFigmaSelection: (cb) => on(IPC.figmaSelection, cb),
  onOpenSettings: (cb) => on(IPC.menuSettings, cb),
  answerFigmaApproval: (id, allow) => ipcRenderer.invoke(IPC.figmaApproval, id, allow),
  figmaPluginCount: () => ipcRenderer.invoke(IPC.figmaPluginCount),
  selectInFigma: (nodeId, focus) => ipcRenderer.invoke(IPC.figmaSelect, nodeId, focus),
  forgetFigmaPlugins: () => ipcRenderer.invoke(IPC.figmaForget),
  runDoctor: (only) => ipcRenderer.invoke(IPC.doctorRun, only),
  runBenchmark: () => ipcRenderer.invoke(IPC.doctorBenchmark),
  buildVanillaCache: () => ipcRenderer.invoke(IPC.doctorBuildCache),
  doctorFirstLaunch: () => ipcRenderer.invoke(IPC.doctorFirstLaunch),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSetting: (k, v) => ipcRenderer.invoke(IPC.settingsSet, k, v),
  browseSetting: (k, folder, title) => ipcRenderer.invoke(IPC.settingsBrowse, k, folder, title),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  getDeployTargets: () => ipcRenderer.invoke(IPC.deployTargets),
  prepareDeploy: (t, s, a) => ipcRenderer.invoke(IPC.deployPrepare, t, s, a),
  commitDeploy: (token) => ipcRenderer.invoke(IPC.deployCommit, token),
  cancelDeploy: () => ipcRenderer.invoke(IPC.deployCancel),
  revealPackage: () => ipcRenderer.invoke(IPC.packageReveal),
  getFontStatus: () => ipcRenderer.invoke(IPC.fontsStatus),
  installFonts: () => ipcRenderer.invoke(IPC.fontsInstall),
  removeFonts: () => ipcRenderer.invoke(IPC.fontsRemove),
  onFontProgress: (cb) => on(IPC.fontsProgress, cb)
}
contextBridge.exposeInMainWorld('inkwell', api)
