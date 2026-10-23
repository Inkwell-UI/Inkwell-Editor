import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { IPC, type SaveOverlayResult } from '../shared/ipc'
import { normalizeOverlay, type OverlayDoc } from '../shared/overlay'
import type { PreviewBuild, PreviewRendered } from '../shared/preview'
import type { OpenResult, ProjectState, RecentProject } from '../shared/projectState'
import { flattenReports, type SwfReport, type SyncUiState } from '../shared/syncState'
import { ffdecState } from '../shared/ffdec'
import { defaultInstalledDir, modeFromEnv, resolvePreviewFonts, type PreviewFontSet } from './previewFonts'
import { loadProject, type ProjectMeta } from './project'
import { writeOverlay } from './project/overlayFile'
import { addRecent, loadRecent, saveRecent } from './project/recent'
import { writeProjectSetting } from './project/settings'
import { createBuildPipeline, envConfig } from './sync/buildPipeline'
import { startSyncServer, type Layer, type SwfInfo } from './sync/syncServer'

export interface SessionDeps {
  appPath: string
  userData: string
  editorVersion: string
  /** Sends `payload` on `channel` to every window. */
  broadcast(channel: string, payload: unknown): void
}

/**
 * Everything that belongs to one open project (or to none): the sync server, the build pipeline, the latest reports and preview builds,
 * the overlays and the state the renderer sees. `open(dir)` replaces it all (the server restarts on the same port and token, so the Figma
 * plugin only has to reconnect). index.ts only wires windows and IPC to this.
 */
export function createSession(deps: SessionDeps) {
  const recentFile = join(deps.userData, 'recent-projects.json')
  let state: SyncUiState = { server: 'starting', connections: 0, build: 'idle', lintCount: 0, swfCount: 0, orphanedCount: 0 }
  const update = (patch: Partial<SyncUiState>): void => {
    state = { ...state, ...patch }
    deps.broadcast(IPC.syncUpdate, state)
  }

  let projectDir: string | undefined
  let meta: ProjectMeta | undefined
  let strict = false
  const overlays = new Map<string, OverlayDoc>() // swf id -> overlay (the renderer is the source of truth once it saves)
  const lintBySwf = new Map<string, number>()
  const unreachableBySwf = new Map<string, { id: string; name: string; swfName: string }[]>()
  const reports = new Map<string, SwfReport>()
  const previews = new Map<string, PreviewBuild>()
  let looseCount = 0
  let previewSeq = 0
  let latestSeq = 0
  let buildSeq = 0
  let everBuilt = false
  let javaOk = true
  let server: Awaited<ReturnType<typeof startSyncServer>> | undefined
  let pipeline: ReturnType<typeof createBuildPipeline> | undefined
  let failBuilds = false // screenshot driver only: makes the next builds throw
  const cfg = envConfig()
  const jarPath = join(deps.appPath, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
  let fontSet: PreviewFontSet | undefined
  // Installed Skyrim fonts are read-only input; INKWELL_PREVIEW_FONTS=bundled|installed|auto forces the source.
  const fonts = (): PreviewFontSet =>
    (fontSet ??= resolvePreviewFonts({
      mode: modeFromEnv(process.env['INKWELL_PREVIEW_FONTS']),
      bundledDir: join(deps.appPath, 'resources/preview-fonts'),
      ...(defaultInstalledDir() ? { installedDir: defaultInstalledDir()! } : {})
    }))

  const refreshFfdec = (): void =>
    update({ ffdec: ffdecState({ installed: existsSync(join(cfg.ffdecDir, 'lib', 'ffdec_lib.jar')), jarBuilt: existsSync(jarPath), javaOk, everBuilt }) })
  // `java -version` once, off the main thread; a missing Java makes builds fail with a clear status instead of a crash
  execFile(cfg.javaPath, ['-version'], { timeout: 8000, windowsHide: true }, (err) => {
    javaOk = !err
    refreshFfdec()
  })

  let pushTimer: ReturnType<typeof setTimeout> | undefined
  const projectState = (): ProjectState | null => {
    if (!projectDir || !meta || !server) return null
    const swfs = server
      .swfs()
      .flatMap((i) => {
        const ir = server!.ir(i.id)
        return ir ? [{ id: i.id, name: i.name, orphaned: i.orphaned, ir, overlay: overlays.get(i.id) ?? normalizeOverlay({}) }] : []
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    return { dir: projectDir, name: meta.name, modId: meta.modId, strictMode: strict, swfs }
  }
  const pushProject = (): void => {
    clearTimeout(pushTimer)
    pushTimer = setTimeout(() => deps.broadcast(IPC.projectUpdate, projectState()), 50)
  }
  const pushProjectNow = (): void => {
    clearTimeout(pushTimer)
    deps.broadcast(IPC.projectUpdate, projectState())
  }

  async function stopServer(): Promise<void> {
    pipeline?.stop()
    await server?.close()
    server = undefined
    pipeline = undefined
  }

  async function start(dir: string | undefined, keep?: { port: number; token: string }): Promise<void> {
    const initial: Record<string, Swf> = {}
    overlays.clear()
    if (dir) {
      const p = await loadProject(dir)
      meta = p.meta
      strict = p.meta.strictMode === true
      for (const [name, s] of Object.entries(p.swfs)) {
        const ir = Swf.parse(s.ir)
        initial[name] = ir
        overlays.set(ir.id, normalizeOverlay(s.overlay))
      }
    } else meta = undefined
    projectDir = dir
    pipeline = createBuildPipeline({
      ...cfg,
      previewFonts: fonts(),
      ...(dir ? { projectDir: dir } : {}),
      buildDir: dir ? join(dir, 'build') : join(deps.userData, 'build'),
      jarPath,
      onBuild: (_p, timing, _n, report) => {
        everBuilt = true
        reports.set(report.swfId, report)
        update({ timing, timingSwf: report.name, buildSeq: ++buildSeq, previewMs: undefined, ...flattenReports(reports.values()) })
        refreshFfdec()
        pushProject()
      },
      onPreview: (p) => {
        const build = { ...p, seq: (latestSeq = ++previewSeq) }
        previews.set(build.swfId, build)
        deps.broadcast(IPC.previewBuild, build)
      }
    })
    const pl = pipeline
    const opts = {
      editorVersion: deps.editorVersion,
      initial,
      strict: () => strict,
      onChange: (id: string, ir: Swf, name: string) => {
        if (failBuilds) throw new Error('Injected build failure (screenshot driver)')
        return pl.onChange(id, ir, name)
      }
    }
    // same port and token as before, so the Figma plugin only has to reconnect; if the port is taken, the first free default
    const srv = await (keep ? startSyncServer({ ...opts, token: keep.token, ports: [keep.port] }).catch(() => startSyncServer(opts)) : startSyncServer(opts))
    server = srv
    srv.events.on('connections', (connections: number) => update({ connections, ...(connections > 0 ? { connectionIssue: undefined } : {}) }))
    srv.events.on('handshakeFailed', (message: string) => update({ connectionIssue: { kind: 'version', message } }))
    srv.events.on('rejected', (reason: string) =>
      update({ connectionIssue: { kind: 'auth', message: reason === 'token' ? 'The plugin used a wrong session token.' : 'Connection from a disallowed origin was refused.' } })
    )
    srv.events.on('selection', (ids: string[]) => deps.broadcast(IPC.figmaSelection, ids))
    srv.events.on('status', (s: { swfId?: string; state: 'compiling' | 'synced' | 'error'; issues?: { message: string; code?: string; nodeId?: string }[] }) => {
      if (s.swfId && s.state !== 'compiling') {
        lintBySwf.set(s.swfId, s.issues?.length ?? 0)
        const name = srv.swfs().find((i) => i.id === s.swfId)?.name ?? s.swfId
        unreachableBySwf.set(
          s.swfId,
          (s.issues ?? []).filter((i) => i.code === 'unreachable-node' && i.nodeId).map((i) => ({ id: i.nodeId!, name: srv.ir(s.swfId!)?.nodes[i.nodeId!]?.name ?? i.nodeId!, swfName: name }))
        )
      }
      update({
        build: s.state,
        buildError: s.state === 'error' ? s.issues?.[0]?.message : undefined,
        lintCount: [...lintBySwf.values()].reduce((a, b) => a + b, 0) + looseCount,
        unreachableNodes: [...unreachableBySwf.values()].flat()
      })
      pushProject()
    })
    srv.events.on('swfs', (infos: SwfInfo[], loose: Layer[]) => {
      looseCount = loose.length
      update({ swfCount: infos.length, orphanedCount: infos.filter((i) => i.orphaned).length, looseLayers: loose, lintCount: [...lintBySwf.values()].reduce((a, b) => a + b, 0) + looseCount })
      pushProject()
    })
    update({ swfCount: srv.swfs().length, server: 'listening', error: undefined, port: srv.port, token: srv.token, looseLayers: [] })
    refreshFfdec()
  }

  /** Switch to `dir` (or to no project). Everything of the previous project is dropped. */
  async function open(dir: string | undefined): Promise<OpenResult> {
    const keep = server ? { port: server.port, token: server.token } : undefined
    try {
      await stopServer()
      reports.clear()
      previews.clear()
      lintBySwf.clear()
      unreachableBySwf.clear()
      looseCount = 0
      update({ connections: 0, build: 'idle', buildError: undefined, lintCount: 0, fonts: [], lint: [], timing: undefined, previewMs: undefined, unreachableNodes: [], connectionIssue: undefined })
      await start(dir, keep)
      if (dir && meta) await remember({ dir, name: meta.name, openedAt: new Date().toISOString() })
      pushProjectNow()
      return { ok: true }
    } catch (e) {
      // leave a working (project-less) session behind rather than a dead server
      await stopServer().catch(() => undefined)
      await start(undefined, keep).catch(() => undefined)
      pushProjectNow()
      const msg = e instanceof Error ? e.message : String(e)
      update({ server: server ? 'listening' : 'error', ...(server ? {} : { error: msg }) })
      return { ok: false, error: msg }
    }
  }

  async function remember(r: RecentProject): Promise<void> {
    await saveRecent(recentFile, addRecent(await loadRecent(recentFile), r)).catch(() => undefined)
  }

  return {
    open,
    getSync: (): SyncUiState => state,
    getProject: projectState,
    getPreviews: (): PreviewBuild[] => [...previews.values()],
    getPreviewFonts: () => fonts().fonts,
    recent: (): Promise<RecentProject[]> => loadRecent(recentFile),
    onPreviewRendered(r: PreviewRendered): void {
      if (r.seq === latestSeq) update({ previewMs: r.ms })
    },
    async saveOverlay(swfName: string, doc: OverlayDoc): Promise<SaveOverlayResult> {
      const info = server?.swfs().find((i) => i.name === swfName)
      if (!projectDir || !info) return { ok: false, error: 'No such swf in the open project' }
      const r = await writeOverlay(projectDir, swfName, doc)
      if (r.ok) {
        overlays.set(info.id, normalizeOverlay(doc))
        server!.rebuild(info.id) // instance names feed the compiler
      }
      return r
    },
    async setStrictMode(on: boolean): Promise<void> {
      if (!projectDir) return
      await writeProjectSetting(projectDir, 'strictMode', on)
      strict = on
      server?.rebuildAll()
      pushProjectNow()
    },
    buildAll: (): number => {
      refreshFfdec()
      return server?.rebuildAll() ?? 0
    },
    /** Screenshot driver only. */
    debug: {
      failBuilds: (on: boolean): void => void (failBuilds = on),
      rebuildAll: (): number => server?.rebuildAll() ?? 0,
      seedBuilds: (): void => {
        for (const i of server?.swfs() ?? []) {
          const ir = server!.ir(i.id)
          if (ir && !i.orphaned) void pipeline!.onChange(i.id, ir, i.name).catch((e: unknown) => console.error('[inkwell] initial build failed:', e))
        }
      }
    },
    stop: async (): Promise<void> => {
      clearTimeout(pushTimer)
      await stopServer()
    }
  }
}
