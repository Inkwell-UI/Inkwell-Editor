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
import type { DeployResult, DeployScope, DeployState, DeployTargetId, DeployTargetInfo, PrepareResult } from '../shared/deploy'
import type { BenchmarkResult, BuildCacheResult, CheckId, CheckResult, ResolvedSettings, SetSettingResult, SettingKey, StoredSettings } from '../shared/doctor'
import { buildCacheAction, runBenchmark, runDoctor, type DoctorContext } from './doctor'
import { createDeployService } from './deploy/service'
import { loadSettings, normalizeValue, patchSettings, refuseReason, resolveSettings, saveSettings, settingProblems } from './settings'
import { defaultInstalledDir, modeFromEnv, resolvePreviewFonts, type PreviewFontSet } from './previewFonts'
import { loadProject, type ProjectMeta } from './project'
import { writeOverlay } from './project/overlayFile'
import { addRecent, loadRecent, saveRecent } from './project/recent'
import { writeProjectSetting } from './project/settings'
import { createBuildPipeline } from './sync/buildPipeline'
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
  // settings: stored in <userData>/settings.json, INKWELL_* environment variables override; read live so a change needs no restart
  const settingsFile = join(deps.userData, 'settings.json')
  let stored: StoredSettings = {}
  const settingsReady = loadSettings(settingsFile).then((s) => void (stored = s))
  const resolved = (): ResolvedSettings => resolveSettings(stored)
  const cfg = {
    get javaPath(): string { return resolved().javaPath },
    get ffdecDir(): string { return resolved().ffdecDir }
  }
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
  const probeJava = (): void => {
    // spawn can throw synchronously on Windows (EFTYPE, UNKNOWN: a file that is not a program); that is a missing Java, not a crash
    try {
      execFile(cfg.javaPath, ['-version'], { timeout: 8000, windowsHide: true }, (err) => {
        javaOk = !err
        refreshFfdec()
      })
    } catch {
      javaOk = false
      refreshFfdec()
    }
  }
  void settingsReady.then(probeJava)

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
    await settingsReady
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

  let deployState = 0
  const reportDeploy = (s: DeployState): void => update({ deploy: s, deploySeq: ++deployState })
  const deploy = createDeployService({
    userData: deps.userData,
    appPath: deps.appPath,
    project: () => {
      const p = projectState()
      if (!p || !meta) return undefined
      return {
        dir: p.dir, name: p.name, modId: p.modId, deploy: meta.deploy,
        swfs: p.swfs.map((s) => ({
          name: s.name, orphaned: s.orphaned, kind: s.ir.target.kind, ir: s.ir,
          instanceNames: Object.fromEntries((Object.entries(s.overlay.nodes ?? {}) as [string, { instanceName?: string }][]).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName] as [string, string]] : [])))
        }))
      }
    },
    settings: () => ({ stored, resolved: resolved() }),
    saveStored: async (s) => {
      stored = s
      await saveSettings(settingsFile, s)
    },
    ffdec: () => {
      if (!pipeline) throw new Error('No project is open.')
      return pipeline.getFfdec()
    },
    report: reportDeploy
  })
  let writeQueue: Promise<void> = Promise.resolve()
  const viewSettings = async (): Promise<ResolvedSettings> => {
    await settingsReady
    const r = resolved()
    return { ...r, problems: await settingProblems(r) }
  }
  const doctorCtx = (): DoctorContext => ({ settings: resolved(), appPath: deps.appPath, userData: deps.userData, ...(projectDir ? { projectDir } : {}), pluginConnections: state.connections, ...(meta ? { projectName: meta.name } : {}) })

  async function remember(r: RecentProject): Promise<void> {
    await saveRecent(recentFile, addRecent(await loadRecent(recentFile), r)).catch(() => undefined)
  }

  return {
    open,
    getSync: (): SyncUiState => state,
    getSettings: viewSettings,
    /**
     * Stores one setting and returns the settings as used (with `problems`), or the reason it could not be stored: never a bare rejection.
     * Calls are serialised (blur and Enter both commit; two overlapping writes of one file lose one of them on Windows). A change of Java or FFDec
     * re-probes and restarts the build pipeline so the next build uses it.
     */
    setSetting(key: SettingKey, value: string | null): Promise<SetSettingResult> {
      const job = writeQueue.then(async (): Promise<SetSettingResult> => {
        await settingsReady
        const refused = value === null ? undefined : refuseReason(key, value)
        if (refused) return { ok: false, error: refused }
        const before = JSON.stringify([cfg.javaPath, cfg.ffdecDir])
        const prev = stored
        stored = patchSettings(stored, { [key]: value === null ? null : normalizeValue(value)! })
        try {
          await saveSettings(settingsFile, stored)
        } catch (e) {
          stored = prev
          return { ok: false, error: `The setting could not be saved to ${settingsFile}: ${e instanceof Error ? e.message : String(e)}` }
        }
        if (JSON.stringify([cfg.javaPath, cfg.ffdecDir]) !== before) {
          probeJava()
          refreshFfdec()
          if (projectDir) await open(projectDir).catch(() => undefined)
        }
        return { ok: true, settings: await viewSettings() }
      })
      writeQueue = job.then(() => undefined, () => undefined)
      return job.catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    },
    runDoctor: async (only?: CheckId[]): Promise<CheckResult[]> => (await settingsReady, runDoctor(doctorCtx(), only)),
    runBenchmark: async (): Promise<BenchmarkResult> => (await settingsReady, runBenchmark(doctorCtx())),
    buildVanillaCache: async (): Promise<BuildCacheResult> => (await settingsReady, buildCacheAction(doctorCtx())),
    /** True once: the first launch where a check fails. */
    async doctorFirstLaunch(): Promise<boolean> {
      await settingsReady
      if (stored.doctorSeen) return false
      const failed = (await runDoctor(doctorCtx())).some((c) => c.status === 'fail')
      stored = { ...stored, doctorSeen: true }
      await saveSettings(settingsFile, stored).catch(() => undefined)
      return failed
    },
    deployTargets: (): DeployTargetInfo[] => deploy.targets(),
    deployPrepare: (id: DeployTargetId, scope: DeployScope, active?: string): Promise<PrepareResult> => deploy.prepare(id, scope, active),
    deployCommit: (token: string): Promise<DeployResult> => deploy.commit(token),
    deployCancel: (): void => deploy.cancel(),
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
