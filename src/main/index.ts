import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { PRODUCT_NAME } from '../shared/product'
import { flattenReports, type SwfReport, type SyncUiState } from '../shared/syncState'
import { loadProject } from './project'
import { createBuildPipeline, envConfig } from './sync/buildPipeline'
import { startSyncServer, type Layer, type SwfInfo } from './sync/syncServer'

let state: SyncUiState = { server: 'starting', connections: 0, build: 'idle', lintCount: 0, swfCount: 0, orphanedCount: 0 }
let win: BrowserWindow | undefined
const update = (patch: Partial<SyncUiState>): void => {
  state = { ...state, ...patch }
  win?.webContents.send('sync:update', state)
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
let server: Awaited<ReturnType<typeof startSyncServer>> | undefined
let pipeline: ReturnType<typeof createBuildPipeline> | undefined

async function startSync(): Promise<void> {
  // INKWELL_PROJECT: project folder whose swfs/<name>/ir.json seeds the store and receives what Figma sends.
  const projectDir = process.env['INKWELL_PROJECT']
  const initial: Record<string, Swf> = {}
  if (projectDir) for (const [name, s] of Object.entries((await loadProject(projectDir)).swfs)) initial[name] = Swf.parse(s.ir)
  pipeline = createBuildPipeline({
    ...envConfig(),
    ...(projectDir ? { projectDir } : {}),
    buildDir: projectDir ? join(projectDir, 'build') : join(app.getPath('userData'), 'build'),
    jarPath: join(app.getAppPath(), 'tools/ffdec-wrapper/build/ffdec-wrapper.jar'),
    onBuild: (_p, timing, _n, report) => {
      reports.set(report.swfId, report)
      update({ timing, ...flattenReports(reports.values()) })
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
  update({ swfCount: server.swfs().length })
  update({ server: 'listening', port: server.port, token: server.token })
}

ipcMain.handle('sync:get', () => state)
void app.whenReady().then(() => {
  createWindow()
  startSync().catch((e: unknown) => update({ server: 'error', error: e instanceof Error ? e.message : String(e) }))
})
app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  pipeline?.stop()
  void server?.close()
})
