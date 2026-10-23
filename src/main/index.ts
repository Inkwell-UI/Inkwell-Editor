import { app, BrowserWindow, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { IPC } from '../shared/ipc'
import type { PreviewBuild, PreviewFontBlob, PreviewRendered } from '../shared/preview'
import { PRODUCT_NAME } from '../shared/product'
import { flattenReports, type SwfReport, type SyncUiState } from '../shared/syncState'
import { defaultInstalledDir, modeFromEnv, resolvePreviewFonts, type PreviewFontSet } from './previewFonts'
import { loadProject } from './project'
import { createBuildPipeline, envConfig } from './sync/buildPipeline'
import { startSyncServer, type Layer, type SwfInfo } from './sync/syncServer'

let state: SyncUiState = { server: 'starting', connections: 0, build: 'idle', lintCount: 0, swfCount: 0, orphanedCount: 0 }
let win: BrowserWindow | undefined
const update = (patch: Partial<SyncUiState>): void => {
  state = { ...state, ...patch }
  // closing the app closes the plugin's socket, which calls update() after the window is gone
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.syncUpdate, state)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: PRODUCT_NAME,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

// Lint issues per swf (from its last build) + loose layers; the window shows the total.
const lintBySwf = new Map<string, number>()
let looseCount = 0
const lintTotal = (): number => [...lintBySwf.values()].reduce((a, b) => a + b, 0) + looseCount

const reports = new Map<string, SwfReport>() // swf id -> latest build
const previews = new Map<string, PreviewBuild>() // swf id -> latest preview build (the renderer restores from this after a reload)
let previewSeq = 0
let latestSeq = 0
let server: Awaited<ReturnType<typeof startSyncServer>> | undefined
let pipeline: ReturnType<typeof createBuildPipeline> | undefined
let previewFontSet: PreviewFontSet | undefined
// Installed Skyrim fonts are read-only input; INKWELL_PREVIEW_FONTS=bundled|installed|auto forces the source.
const previewFonts = (): PreviewFontSet =>
  (previewFontSet ??= resolvePreviewFonts({
    mode: modeFromEnv(process.env['INKWELL_PREVIEW_FONTS']),
    bundledDir: join(app.getAppPath(), 'resources/preview-fonts'),
    ...(defaultInstalledDir() ? { installedDir: defaultInstalledDir()! } : {})
  }))

async function startSync(): Promise<void> {
  // INKWELL_PROJECT: project folder whose swfs/<name>/ir.json seeds the store and receives what Figma sends.
  const projectDir = process.env['INKWELL_PROJECT']
  const initial: Record<string, Swf> = {}
  if (projectDir) for (const [name, s] of Object.entries((await loadProject(projectDir)).swfs)) initial[name] = Swf.parse(s.ir)
  pipeline = createBuildPipeline({
    ...envConfig(),
    previewFonts: previewFonts(),
    ...(projectDir ? { projectDir } : {}),
    buildDir: projectDir ? join(projectDir, 'build') : join(app.getPath('userData'), 'build'),
    jarPath: join(app.getAppPath(), 'tools/ffdec-wrapper/build/ffdec-wrapper.jar'),
    onBuild: (_p, timing, _n, report) => {
      reports.set(report.swfId, report)
      update({ timing, previewMs: undefined, ...flattenReports(reports.values()) })
    },
    onPreview: (p) => {
      const build = { ...p, seq: (latestSeq = ++previewSeq) }
      previews.set(build.swfId, build)
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.previewBuild, build)
    }
  })
  server = await startSyncServer({ editorVersion: app.getVersion(), initial, onChange: pipeline.onChange })
  server.events.on('connections', (connections: number) => update({ connections }))
  server.events.on('status', (s: { swfId?: string; state: 'compiling' | 'synced' | 'error'; issues?: { message: string }[] }) => {
    if (s.swfId && s.state !== 'compiling') lintBySwf.set(s.swfId, s.issues?.length ?? 0)
    update({ build: s.state, buildError: s.state === 'error' ? s.issues?.[0]?.message : undefined, lintCount: lintTotal() })
  })
  server.events.on('swfs', (infos: SwfInfo[], loose: Layer[]) => {
    looseCount = loose.length
    update({ swfCount: infos.length, orphanedCount: infos.filter((i) => i.orphaned).length, lintCount: lintTotal() })
  })
  // debug: with INKWELL_SCREENSHOT the project's swfs are built right away, so a preview exists without the Figma plugin
  if (process.env['INKWELL_SCREENSHOT'])
    for (const [name, ir] of Object.entries(initial)) pipeline.onChange(ir.id, ir, name).catch((e: unknown) => console.error('[inkwell] initial build failed:', e))
  update({ swfCount: server.swfs().length })
  update({ server: 'listening', port: server.port, token: server.token })
}

ipcMain.handle(IPC.syncGet, () => state)
ipcMain.handle(IPC.previewFonts, (): PreviewFontBlob[] =>
  previewFonts().fonts.map((f) => ({ name: f.family, bytes: f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer }))
)
ipcMain.handle(IPC.previewGet, () => [...previews.values()])
let shot = process.env['INKWELL_SCREENSHOT'] // debug: save the window after the first rendered preview, then quit
ipcMain.on(IPC.previewRendered, (_e, r: PreviewRendered) => {
  if (r.seq === latestSeq) update({ previewMs: r.ms })
  if (shot && win) {
    const out = shot
    shot = undefined
    // two frames for the panels to repaint with the timing before the capture
    setTimeout(() => void win!.webContents.capturePage().then((img) => writeFile(out, img.toPNG())).finally(() => app.exit(0)), 500)
  }
})
void app.whenReady().then(() => {
  createWindow()
  startSync().catch((e: unknown) => update({ server: 'error', error: e instanceof Error ? e.message : String(e) }))
})
app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  pipeline?.stop()
  void server?.close()
})
