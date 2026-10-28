import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { AppMenu } from '../shared/appMenu'
import type { DeployScope, DeployTargetId } from '../shared/deploy'
import type { CheckId, PathSettingKey, SetSettingResult, SettingKey } from '../shared/doctor'
import type { OverlayDoc } from '../shared/overlay'
import type { PreviewFontBlob, PreviewRendered } from '../shared/preview'
import type { OpenResult, UiEvent } from '../shared/projectState'
import { PRODUCT_NAME } from '../shared/product'
import { strings } from '../renderer/strings'
import type { AddFontOutcome } from '../shared/fonts'
import type { LocFileResult } from '../shared/ipc'
import { exportCsvFile, exportTranslationFiles, readCsvImport } from './localizationIo'
import { appMenuModel, type RoleEntry } from './appMenuModel'
import { copyExample, createProject } from './project/lifecycle'
import { runDoctorDriver } from './screenshotDoctor'
import { runFigmaShots } from './screenshotFigma'
import { runFontShots } from './screenshotFonts'
import { runShots } from './screenshotDriver'
import { runDebugShots, runGraphShots } from './screenshotGraph'
import { runPopupShots } from './screenshotPopup'
import { runMenuShots } from './screenshotMenu'
import { runDevShots } from './screenshotDev'
import { runGlyphShots } from './screenshotGlyphs'
import { runInventoryShots } from './screenshotInventory'
import { runMenuNodesShots } from './screenshotMenuNodes'
import { runSetupShots } from './screenshotSetup'
import { createSession } from './session'

let win: BrowserWindow | undefined
let previewWin: BrowserWindow | undefined

const broadcast = (channel: string, payload: unknown): void => {
  // closing the app closes the plugin's socket, which updates state after the windows are gone
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload)
}
/** Save dialog for Package Mod. INKWELL_SHOTS_PACKAGE_DIR (screenshot runs) answers it with that folder, since a script cannot click a native dialog. */
async function chooseZip(defaultPath: string): Promise<string | undefined> {
  const stub = process.env['INKWELL_SHOTS_PACKAGE_DIR']
  if (stub) return join(stub, basename(defaultPath))
  await mkdir(dirname(defaultPath), { recursive: true }).catch(() => undefined) // <project>/dist, so the dialog opens there
  const r = await dialog.showSaveDialog(win!, { title: strings.deploy.saveTitle, defaultPath, filters: [{ name: strings.deploy.zipFilter, extensions: ['zip'] }] })
  return r.canceled || !r.filePath ? undefined : r.filePath
}
const session = createSession({ appPath: app.getAppPath(), userData: app.getPath('userData'), editorVersion: app.getVersion(), broadcast, chooseZip })

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
    // the renderer draws the title bar (menus + title, `shell/TitleBar.tsx`); Windows paints the min/max/close buttons over it. Colors = theme.css --surface-1 / --fg, height = .titlebar
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#202024', symbolColor: '#e4e4e7', height: 36 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
  })
  win.setMenuBarVisibility(false) // the native menu stays set (its accelerators work) but is never drawn
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
// the File menu's Open Recent list follows every open
const attempt = async (fn: () => Promise<OpenResult>): Promise<OpenResult> =>
  fn()
    .catch((e: unknown): OpenResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    .finally(() => void buildMenu())
/** A File menu open: the renderer follows through the project update; a failure has no start screen to show it, so it gets a dialog. */
const fromMenu = (fn: () => Promise<OpenResult>): void =>
  void attempt(fn).then((r) => {
    if (!r.ok && 'error' in r) dialog.showErrorBox(strings.menu.openFailed, r.error)
  })

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
ipcMain.handle(IPC.previewTheme, (_e, swfName: string, mode: string) => session.setPreviewTheme(swfName, mode))
ipcMain.handle(IPC.swfTarget, (_e, swfName: string, kind: unknown, more: { contract?: unknown; layers?: unknown } | undefined) => session.setTarget(swfName, kind, more ?? {}))
ipcMain.handle(IPC.contractsList, () => session.listContracts())
ipcMain.handle(IPC.menuSave, (_e, swfName: string, doc: unknown) => session.saveMenuSettings(swfName, doc))
ipcMain.handle(IPC.projectFonts, () => session.getProjectFonts())
ipcMain.handle(IPC.projectFontSave, (_e, hash: string, settings: { charsets: string[]; extraChars: string }) => session.saveProjectFontSettings(hash, settings))
ipcMain.handle(IPC.projectFontAdd, async (): Promise<AddFontOutcome> => {
  const r = await dialog.showOpenDialog(win!, { title: strings.insp.embeddedFont.pickTitle, properties: ['openFile'], filters: [{ name: strings.insp.embeddedFont.filter, extensions: ['ttf'] }] })
  if (r.canceled || !r.filePaths[0]) return { ok: false, error: '', cancelled: true }
  return session.addProjectFontFile(r.filePaths[0])
})
ipcMain.handle(IPC.locLoad, () => session.getLocalization())
ipcMain.handle(IPC.locSave, (_e, doc: unknown) => session.saveLocalization(doc))
const locFail = (e: unknown): LocFileResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) })
ipcMain.handle(IPC.locCsvExport, async (): Promise<LocFileResult> => {
  const s = session.getLocalization()
  if (!s.localization) return { ok: false, error: s.error ?? strings.loc.noTable }
  const r = await dialog.showSaveDialog(win!, { title: strings.loc.csvSaveTitle, defaultPath: `${s.modId || 'translations'}-translations.csv`, filters: [{ name: strings.loc.csvFilter, extensions: ['csv'] }] })
  if (r.canceled || !r.filePath) return { ok: false, error: '', cancelled: true }
  try {
    await exportCsvFile(r.filePath, s.localization)
    return { ok: true, summary: strings.loc.exported(1, r.filePath) }
  } catch (e) {
    return locFail(e)
  }
})
ipcMain.handle(IPC.locCsvImport, async (): Promise<LocFileResult> => {
  const s = session.getLocalization()
  if (!s.localization) return { ok: false, error: s.error ?? strings.loc.noTable }
  const r = await dialog.showOpenDialog(win!, { title: strings.loc.csvOpenTitle, properties: ['openFile'], filters: [{ name: strings.loc.csvFilter, extensions: ['csv'] }] })
  if (r.canceled || !r.filePaths[0]) return { ok: false, error: '', cancelled: true }
  try {
    const m = await readCsvImport(r.filePaths[0], s.localization)
    const { languagesAdded, keysAdded, cellsChanged, cellsAdded } = m.report
    if (!languagesAdded.length && !keysAdded && !cellsChanged && !cellsAdded) return { ok: true, summary: strings.loc.importNothing }
    const ask = await dialog.showMessageBox(win!, { type: 'question', buttons: [strings.loc.importApply, 'Cancel'], defaultId: 1, cancelId: 1, title: strings.loc.importCsv, message: strings.loc.importConfirm(m.report) })
    if (ask.response !== 0) return { ok: false, error: '', cancelled: true }
    const saved = await session.saveLocalization(m.localization)
    return saved.ok ? { ok: true, summary: strings.loc.importConfirm(m.report), localization: m.localization } : { ok: false, error: saved.error }
  } catch (e) {
    return locFail(e)
  }
})
ipcMain.handle(IPC.locTxtExport, async (): Promise<LocFileResult> => {
  const s = session.getLocalization()
  if (!s.localization) return { ok: false, error: s.error ?? strings.loc.noTable }
  const dir = await pickFolder(strings.loc.txtFolderTitle)
  if (!dir) return { ok: false, error: '', cancelled: true }
  try {
    const files = await exportTranslationFiles(dir, s.modId, s.localization)
    return { ok: true, summary: strings.loc.exported(files.length, dir) }
  } catch (e) {
    return locFail(e)
  }
})
ipcMain.handle(IPC.graphsList, (_e, swf: string) => session.listGraphs(swf))
ipcMain.handle(IPC.graphsLoad, (_e, swf: string, id: string) => session.loadGraph(swf, id))
ipcMain.handle(IPC.graphsSave, (_e, swf: string, g: unknown) => session.saveGraph(swf, g))
ipcMain.handle(IPC.graphsCreate, (_e, swf: string, name: string, scope: 'menu' | 'component') => session.createGraph(swf, name, scope))
ipcMain.handle(IPC.graphsDelete, (_e, swf: string, id: string) => session.deleteGraph(swf, id))
ipcMain.handle(IPC.swfDiscard, (_e, swfId: string) => session.discardSwf(swfId))
ipcMain.handle(IPC.graphsAs2, (_e, swf: string, g: unknown) => session.graphAs2(swf, g))
ipcMain.handle(IPC.packsGet, () => session.getPacks())
ipcMain.handle(IPC.packsState, () => session.packsState())
ipcMain.handle(IPC.packsIndex, () => session.packsIndex())
ipcMain.handle(IPC.packsResolve, (_e, input: unknown) => session.packsResolve(String(input)))
ipcMain.handle(IPC.packsInstall, (_e, token: unknown) => session.packsInstall(String(token)))
ipcMain.handle(IPC.packsRestore, () => session.packsRestore())
ipcMain.handle(IPC.packsUpdates, () => session.packsCheckUpdates())
ipcMain.handle(IPC.strictSet, (_e, on: boolean) => session.setStrictMode(on))
ipcMain.handle(IPC.modIdSet, (_e, id: string) => session.setModId(id))
ipcMain.handle(IPC.buildAll, () => session.buildAll())
ipcMain.handle(IPC.previewDetach, (_e, detached: boolean) => setDetached(detached))
ipcMain.handle(IPC.previewDetached, () => !!previewWin && !previewWin.isDestroyed())
ipcMain.handle(IPC.figmaApproval, (_e, id: number, allow: boolean) => session.answerFigmaApproval(id, allow === true))
ipcMain.handle(IPC.figmaPluginCount, () => session.figmaPluginCount())
ipcMain.handle(IPC.figmaSelect, (_e, nodeId: string, focus: boolean) => session.selectInFigma(String(nodeId), focus === true))
ipcMain.handle(IPC.figmaForget, () => session.forgetFigmaPlugins())
ipcMain.handle(IPC.doctorRun, (_e, only?: CheckId[]) => session.runDoctor(only))
ipcMain.handle(IPC.doctorBenchmark, () => session.runBenchmark())
ipcMain.handle(IPC.doctorBuildCache, () => session.buildVanillaCache())
ipcMain.handle(IPC.doctorFirstLaunch, () => session.doctorFirstLaunch())
ipcMain.handle(IPC.settingsGet, () => session.getSettings())
ipcMain.handle(IPC.settingsSet, (_e, key: SettingKey, value: string | null) => session.setSetting(key, value))
// debug only (INKWELL_DOCTOR_DRIVER): the driver answers the native dialog (a path, or null = cancelled) because a script cannot click it
const debugDialog: { answer: string | null | undefined } = { answer: undefined }
ipcMain.handle(IPC.settingsBrowse, async (_e, key: PathSettingKey, folder: boolean, title: string): Promise<SetSettingResult> => {
  try {
    const stub = process.env['INKWELL_DOCTOR_DRIVER'] ? debugDialog.answer : undefined
    debugDialog.answer = undefined
    const r = stub !== undefined ? { canceled: stub === null, filePaths: stub ? [stub] : [] } : await dialog.showOpenDialog(win!, { title, properties: folder ? ['openDirectory'] : ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return { ok: true, settings: await session.getSettings(), cancelled: true }
    return await session.setSetting(key, r.filePaths[0])
  } catch (e) {
    return { ok: false, error: `The file dialog failed: ${e instanceof Error ? e.message : String(e)}` }
  }
})
// only https pages the editor itself names (fix actions); never a renderer-supplied scheme
ipcMain.handle(IPC.openExternal, (_e, url: string) => (url.startsWith('https://') ? shell.openExternal(url) : undefined))
ipcMain.handle(IPC.deployTargets, () => session.deployTargets())
ipcMain.handle(IPC.deployPrepare, (_e, id: DeployTargetId, scope: DeployScope, active?: string) => session.deployPrepare(id, scope, active))
ipcMain.handle(IPC.deployCommit, (_e, token: string) => session.deployCommit(token))
ipcMain.handle(IPC.deployCancel, () => session.deployCancel())
ipcMain.handle(IPC.packageReveal, () => {
  const p = session.lastPackage()
  if (p) shell.showItemInFolder(p)
})
ipcMain.handle(IPC.devGet, () => session.devState())
ipcMain.handle(IPC.devConnect, () => session.devConnect())
ipcMain.handle(IPC.devDisconnect, () => session.devDisconnect())
ipcMain.handle(IPC.devToken, (_e, token: string | null) => session.devSetToken(token === null ? null : String(token)))
ipcMain.handle(IPC.devPort, (_e, port: number) => session.devSetPort(Number(port)))
ipcMain.handle(IPC.devDeploy, (_e, on: boolean) => session.devSetDeploy(on === true))
ipcMain.handle(IPC.devReload, (_e, menu?: string) => session.devReload(typeof menu === 'string' ? menu : undefined))
ipcMain.handle(IPC.fontsStatus, () => session.fontStatus())
ipcMain.handle(IPC.fontsInstall, () => session.installFonts())
ipcMain.handle(IPC.fontsRemove, () => session.removeFonts())
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

/** The application menu as data for the title bar, and what each entry does (by template path). Rebuilt with the menu. */
let appMenu: AppMenu = []
const menuActions = new Map<string, () => void>()
const ROLES: Record<string, RoleEntry> = {
  undo: { label: strings.menu.undo, key: 'Ctrl+Z', run: () => win?.webContents.send(IPC.menuUndo) },
  redo: { label: strings.menu.redo, key: 'Ctrl+Y', run: () => win?.webContents.send(IPC.menuRedo) },
  cut: { label: strings.menu.cut, key: 'Ctrl+X', run: () => win?.webContents.cut() },
  copy: { label: strings.menu.copy, key: 'Ctrl+C', run: () => win?.webContents.copy() },
  paste: { label: strings.menu.paste, key: 'Ctrl+V', run: () => win?.webContents.paste() },
  selectAll: { label: strings.menu.selectAll, key: 'Ctrl+A', run: () => win?.webContents.selectAll() },
  quit: { label: strings.menu.quit, run: () => app.quit() }
}
ipcMain.handle(IPC.menuModel, () => appMenu)
ipcMain.handle(IPC.menuInvoke, (_e, id: string) => void menuActions.get(String(id))?.())

/** The default menu with project entries added to File and Settings to Edit; every other menu keeps its Electron role. */
async function buildMenu(): Promise<void> {
  const recent = await session.recent().catch(() => [])
  const openDir = (dir: string | undefined, title: string): void => fromMenu(async () => {
    const d = dir ?? (await pickFolder(title))
    return d ? session.open(d) : cancelled
  })
  const template: MenuItemConstructorOptions[] = [
    {
      label: strings.menu.file,
      submenu: [
        {
          label: strings.start.newProject, accelerator: 'CmdOrCtrl+N',
          click: () => fromMenu(async () => {
            const d = await pickFolder(strings.start.newDialog)
            if (!d) return cancelled
            await createProject(d)
            return session.open(d)
          })
        },
        { label: strings.start.openProject, accelerator: 'CmdOrCtrl+O', click: () => openDir(undefined, strings.start.openDialog) },
        { label: strings.menu.openRecent, enabled: recent.length > 0, submenu: recent.map((r) => ({ label: r.name, sublabel: r.dir, click: () => openDir(r.dir, strings.start.openDialog) })) },
        { type: 'separator' },
        { label: strings.menu.save, accelerator: 'CmdOrCtrl+S', enabled: session.getProject() !== null, click: () => win?.webContents.send(IPC.menuSaveNow) },
        {
          label: strings.menu.showFolder,
          enabled: session.getProject() !== null,
          click: () => {
            const p = session.getProject()
            if (p) void shell.openPath(p.dir)
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: strings.menu.edit,
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' },
        { label: strings.menu.settings, accelerator: 'CmdOrCtrl+,', click: () => win?.webContents.send(IPC.menuSettings) }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  menuActions.clear()
  appMenu = appMenuModel(template, '', ROLES, menuActions)
  broadcast(IPC.menuChanged, appMenu)
}

void app.whenReady().then(async () => {
  await buildMenu()
  createWindow()
  // INKWELL_PROJECT: open this project at start (otherwise the start screen shows)
  const dir = process.env['INKWELL_PROJECT']
  await session.open(dir)
  if (dir && process.env['INKWELL_SCREENSHOT']) session.debug.seedBuilds() // debug: a preview exists without the Figma plugin
  const shotsDir = process.env['INKWELL_SHOTS_DIR']
  if (process.env['INKWELL_DOCTOR_DRIVER'])
    void runDoctorDriver({ outDir: shotsDir ?? join(app.getPath('userData'), 'doctor-shots'), projectDir: process.env['INKWELL_SHOTS_PROJECT'], win: () => win, session, dialog: debugDialog }).catch((e: unknown) => { console.error('[driver] failed:', e); app.exit(1) })
  else if (shotsDir && process.env['INKWELL_SHOTS_FIGMA'])
    void runFigmaShots({ outDir: shotsDir, userData: app.getPath('userData'), projectDir: process.env['INKWELL_SHOTS_PROJECT'], win: () => win, session }).catch((e: unknown) => { console.error('[inkwell] figma screenshots failed:', e); app.exit(1) })
  else if (shotsDir && process.env['INKWELL_SHOTS_FONTS'])
    void runFontShots({ outDir: shotsDir, win: () => win }).then(() => app.exit(0), (e: unknown) => { console.error('[inkwell] font screenshots failed:', e); app.exit(1) })
  else if (shotsDir && process.env['INKWELL_SHOTS_DEV'])
    void runDevShots({ outDir: shotsDir, projectDir: process.env['INKWELL_SHOTS_PROJECT']!, win: () => win, session }).then((bad) => app.exit(bad ? 1 : 0), (e: unknown) => { console.error('[inkwell] dev screenshots failed:', e); app.exit(1) })
  else if (shotsDir && process.env['INKWELL_SHOTS_GLYPHS'])
    void runGlyphShots({ outDir: shotsDir, projectDir: process.env['INKWELL_SHOTS_PROJECT']!, win: () => win, session }).then((bad) => app.exit(bad ? 1 : 0), (e: unknown) => { console.error('[inkwell] glyph screenshots failed:', e); app.exit(1) })
  else if (shotsDir && process.env['INKWELL_SHOTS_INVENTORY'])
    void runInventoryShots({ outDir: shotsDir, projectDir: process.env['INKWELL_SHOTS_PROJECT']!, win: () => win, session }).then((bad) => app.exit(bad ? 1 : 0), (e: unknown) => { console.error('[inkwell] inventory screenshots failed:', e); app.exit(1) })
  else if (shotsDir && process.env['INKWELL_SHOTS_MENU'] === 'nodes')
    void runMenuNodesShots({ outDir: shotsDir, projectDir: process.env['INKWELL_SHOTS_PROJECT']!, win: () => win, session }).catch((e: unknown) => { console.error('[inkwell] menu nodes screenshots failed:', e); app.exit(1) })
  else if (shotsDir && process.env['INKWELL_SHOTS_MENU'])
    void runMenuShots({ outDir: shotsDir, projectDir: process.env['INKWELL_SHOTS_PROJECT']!, win: () => win, session }).catch((e: unknown) => { console.error('[inkwell] menu screenshots failed:', e); app.exit(1) })
  else if (shotsDir && process.env['INKWELL_SHOTS_GRAPH'] === 'popup')
    void runPopupShots({ outDir: shotsDir, projectDir: process.env['INKWELL_SHOTS_PROJECT']!, win: () => win, session }).catch((e: unknown) => { console.error('[inkwell] popup screenshots failed:', e); app.exit(1) })
  else if (shotsDir && process.env['INKWELL_SHOTS_GRAPH'] === 'debug')
    void runDebugShots({ outDir: shotsDir, projectDir: process.env['INKWELL_SHOTS_PROJECT']!, win: () => win, session }).catch((e: unknown) => { console.error('[inkwell] debug screenshots failed:', e); app.exit(1) })
  else if (shotsDir && process.env['INKWELL_SHOTS_GRAPH'])
    void runGraphShots({ outDir: shotsDir, projectDir: process.env['INKWELL_SHOTS_PROJECT']!, win: () => win, session }).catch((e: unknown) => { console.error('[inkwell] graph screenshots failed:', e); app.exit(1) })
  else if (shotsDir && process.env['INKWELL_SHOTS_SETUP'])
    void runSetupShots({ outDir: shotsDir, projectDir: process.env['INKWELL_SHOTS_PROJECT']!, win: () => win, session }).catch((e: unknown) => { console.error('[inkwell] screenshots failed:', e); app.exit(1) })
  else if (shotsDir) void runShots({ outDir: shotsDir, projectDir: process.env['INKWELL_SHOTS_PROJECT'], win: () => win, previewWin: () => previewWin, session }).catch((e: unknown) => { console.error('[inkwell] screenshots failed:', e); app.exit(1) })
})
app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => void session.stop())
