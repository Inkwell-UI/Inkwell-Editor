import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { OverlayDoc } from '../shared/overlay'
import type { PreviewFontBlob, PreviewRendered } from '../shared/preview'
import type { OpenResult, UiEvent } from '../shared/projectState'
import { PRODUCT_NAME } from '../shared/product'
import { copyExample, createProject } from './project/lifecycle'
import { runShots } from './screenshotDriver'
import { createSession } from './session'

let win: BrowserWindow | undefined
let previewWin: BrowserWindow | undefined

const broadcast = (channel: string, payload: unknown): void => {
  // closing the app closes the plugin's socket, which updates state after the windows are gone
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload)
}
const session = createSession({ appPath: app.getAppPath(), userData: app.getPath('userData'), editorVersion: app.getVersion(), broadcast })

/** Both windows run the same renderer; `?panel=preview` makes it show only the preview stage. */
function load(w: BrowserWindow, panel?: 'preview'): void {
  if (process.env['ELECTRON_RENDERER_URL']) void w.loadURL(process.env['ELECTRON_RENDERER_URL'] + (panel ? `?panel=${panel}` : ''))
  else void w.loadFile(join(__dirname, '../renderer/index.html'), panel ? { query: { panel } } : undefined)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: PRODUCT_NAME,
    backgroundColor: '#14161a',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
  })
  win.on('closed', () => {
    win = undefined
    previewWin?.close() // the popped-out preview does not outlive the editor
  })
  load(win)
}

/** Pop-out: the same renderer in its own window, fed by the same IPC (sync state, preview builds, project, UI events). Closing it re-docks. */
function setDetached(detached: boolean): void {
  if (!detached) {
    previewWin?.close()
    return
  }
  if (previewWin && !previewWin.isDestroyed()) return previewWin.focus()
  previewWin = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 480,
    minHeight: 320,
    title: `${PRODUCT_NAME} - Preview`,
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
  })
  previewWin.on('closed', () => {
    previewWin = undefined
    broadcast(IPC.previewDetached, false)
  })
  load(previewWin, 'preview')
  broadcast(IPC.previewDetached, true)
}

const pickFolder = async (title: string): Promise<string | undefined> => {
  const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? undefined : r.filePaths[0]
}
const cancelled: OpenResult = { ok: false, cancelled: true }
const attempt = async (fn: () => Promise<OpenResult>): Promise<OpenResult> => fn().catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))

ipcMain.handle(IPC.syncGet, () => session.getSync())
ipcMain.handle(IPC.previewFonts, (): PreviewFontBlob[] =>
  session.getPreviewFonts().map((f) => ({ name: f.family, bytes: f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer }))
)
ipcMain.handle(IPC.previewGet, () => session.getPreviews())
ipcMain.handle(IPC.projectGet, () => session.getProject())
ipcMain.handle(IPC.projectRecent, () => session.recent())
ipcMain.handle(IPC.projectOpen, (_e, dir: string | undefined, title: string | undefined) =>
  attempt(async () => {
    const d = dir ?? (await pickFolder(title ?? 'Open project'))
    return d ? session.open(d) : cancelled
  })
)
ipcMain.handle(IPC.projectNew, (_e, title: string) =>
  attempt(async () => {
    const d = await pickFolder(title)
    if (!d) return cancelled
    await createProject(d)
    return session.open(d)
  })
)
ipcMain.handle(IPC.projectExample, (_e, title: string) =>
  attempt(async () => {
    const d = await pickFolder(title)
    if (!d) return cancelled
    await copyExample(join(app.getAppPath(), 'samples/hud-minimal'), d)
    return session.open(d)
  })
)
ipcMain.handle(IPC.overlaySave, (_e, swfName: string, doc: OverlayDoc) => session.saveOverlay(swfName, doc))
ipcMain.handle(IPC.strictSet, (_e, on: boolean) => session.setStrictMode(on))
ipcMain.handle(IPC.buildAll, () => session.buildAll())
ipcMain.handle(IPC.previewDetach, (_e, detached: boolean) => setDetached(detached))
ipcMain.handle(IPC.previewDetached, () => !!previewWin && !previewWin.isDestroyed())
// selection and active SWF: relayed to every other window
ipcMain.on(IPC.uiEvent, (e, ev: UiEvent) => {
  for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== e.sender && !w.isDestroyed()) w.webContents.send(IPC.uiEvent, ev)
})

let shot = process.env['INKWELL_SCREENSHOT'] // debug: save the window after the first rendered preview, then quit
ipcMain.on(IPC.previewRendered, (_e, r: PreviewRendered) => {
  session.onPreviewRendered(r)
  if (shot && win) {
    const out = shot
    shot = undefined
    // two frames for the panels to repaint with the timing before the capture
    setTimeout(() => void win!.webContents.capturePage().then((img) => writeFile(out, img.toPNG())).finally(() => app.exit(0)), 500)
  }
})

void app.whenReady().then(async () => {
  createWindow()
  // INKWELL_PROJECT: open this project at start (otherwise the start screen shows)
  const dir = process.env['INKWELL_PROJECT']
  await session.open(dir)
  if (dir && process.env['INKWELL_SCREENSHOT']) session.debug.seedBuilds() // debug: a preview exists without the Figma plugin
  const shotsDir = process.env['INKWELL_SHOTS_DIR']
  if (shotsDir) void runShots({ outDir: shotsDir, projectDir: process.env['INKWELL_SHOTS_PROJECT'], win: () => win, previewWin: () => previewWin, session }).catch((e: unknown) => { console.error('[inkwell] screenshots failed:', e); app.exit(1) })
})
app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => void session.stop())
