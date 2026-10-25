import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { join } from 'node:path'
import { Graph, Swf } from '@inkwell-ui/spec'
import { defIndex, emptyGraph, newGraphId, summarize, type GraphResult, type GraphSummary, type PackSet } from '../shared/graphs'
import { validateGraph } from '../shared/graphValidate'
import { IPC, type SaveOverlayResult } from '../shared/ipc'
import { normalizeOverlay, type OverlayDoc } from '../shared/overlay'
import type { PreviewBuild, PreviewRendered } from '../shared/preview'
import type { OpenResult, ProjectState, RecentProject, SnapshotInfo } from '../shared/projectState'
import { flattenReports, type LintRow, type SwfReport, type SyncUiState } from '../shared/syncState'
import { ffdecState } from '../shared/ffdec'
import type { DeployLintItem, DeployResult, DeployScope, DeployState, DeployTargetId, DeployTargetInfo, PrepareResult } from '../shared/deploy'
import type { BenchmarkResult, BuildCacheResult, CheckId, CheckResult, ResolvedSettings, SetSettingResult, SettingKey, StoredSettings } from '../shared/doctor'
import { buildCacheAction, runBenchmark, runDoctor, type DoctorContext } from './doctor'
import { checkSkyrim, type SkyrimFacts } from './doctor/checks'
import { createFontTool } from './fonts'
import { sandboxFontSystem, windowsFontSystem } from './fonts/install'
import { createDeployService } from './deploy/service'
import { createAssetStore, type AssetStore } from './images/assets'
import { loadSettings, normalizeValue, patchSettings, refuseReason, resolveSettings, saveSettings, settingProblems } from './settings'
import { defaultInstalledDir, modeFromEnv, resolvePreviewFonts, type PreviewFontSet } from './previewFonts'
import { corePackDir, loadPacks } from './packs'
import { loadProject, type ProjectMeta } from './project'
import { deleteGraph, readGraph, writeGraph } from './project/graphFiles'
import { writeOverlay } from './project/overlayFile'
import { addRecent, loadRecent, saveRecent } from './project/recent'
import { writeProjectSetting } from './project/settings'
import { readSnapshot, staleSwfs, type FigmaSnapshot, type SnapshotSource } from './project/snapshot'
import { createBuildPipeline } from './sync/buildPipeline'
import { startSyncServer, type Layer, type SwfInfo } from './sync/syncServer'

export interface SessionDeps {
  appPath: string
  userData: string
  editorVersion: string
  /** Sends `payload` on `channel` to every window. */
  broadcast(channel: string, payload: unknown): void
  /** Native save dialog for a package zip (index.ts); undefined = cancelled. */
  chooseZip?(defaultPath: string): Promise<string | undefined>
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
  const graphs = new Map<string, Map<string, Graph>>() // swf name -> graph id -> graph (the renderer saves; main validates)
  let packs: Promise<PackSet> | undefined
  const getPacks = (): Promise<PackSet> => (packs ??= loadPacks([corePackDir(deps.appPath)]))
  const lintBySwf = new Map<string, number>()
  const unreachableBySwf = new Map<string, { id: string; name: string; swfName: string }[]>()
  const reports = new Map<string, SwfReport>()
  const buildBySwf = new Map<string, 'compiling' | 'failed' | 'done'>() // the deploy gate: a custom menu ships its last build only when it finished
  const previews = new Map<string, PreviewBuild>()
  let looseCount = 0
  let snapshot: SnapshotInfo | undefined
  let snapshotSource: SnapshotSource | undefined // the connected plugin's hello; never the session token
  const snapshotInfo = (s: FigmaSnapshot, stale: string[]): SnapshotInfo => ({
    updatedAt: s.updatedAt, swfs: Object.keys(s.swfs).length, stale, ...(s.source?.pluginVersion ? { pluginVersion: s.source.pluginVersion } : {}), ...(s.source?.fileKey ? { fileKey: s.source.fileKey } : {})
  })
  let previewSeq = 0
  let latestSeq = 0
  let buildSeq = 0
  let everBuilt = false
  let javaOk = true
  let server: Awaited<ReturnType<typeof startSyncServer>> | undefined
  let pipeline: ReturnType<typeof createBuildPipeline> | undefined
  let assets: AssetStore = createAssetStore() // per project: <project>/assets/<hash>.png (memory only without a project)
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
    return { dir: projectDir, name: meta.name, modId: meta.modId, strictMode: strict, swfs, ...(snapshot ? { snapshot } : {}) }
  }
  /** Graph issues of every built SWF as lint rows and deploy items: the single place graphs are validated for the Lint dock and the export gate. */
  const graphIssues = new Map<string, { row: LintRow; item: DeployLintItem }[]>() // swf name -> issues
  const lintTotal = (): number => [...lintBySwf.values()].reduce((a, b) => a + b, 0) + looseCount + [...graphIssues.values()].reduce((a, b) => a + b.length, 0)
  async function refreshGraphLint(): Promise<void> {
    const defs = defIndex(await getPacks())
    graphIssues.clear()
    for (const i of server?.swfs() ?? []) {
      const ir = i.orphaned ? undefined : server?.ir(i.id)
      const all = [...(graphs.get(i.name)?.values() ?? [])]
      if (!ir || !all.length) continue
      const layers = new Set(Object.keys(ir.nodes))
      graphIssues.set(i.name, all.flatMap((g) => validateGraph(g, { defs, layers, siblings: all }).map((x) => {
        const layerName = x.targetId ? (ir.nodes[x.targetId]?.name ?? x.targetId) : ''
        const row: LintRow = { swfName: i.name, nodeId: x.targetId ?? '', layerName, severity: x.level, code: x.code, message: `${g.name}: ${x.message}`, graphId: g.id, graphNodeId: x.nodeId! }
        return { row, item: { severity: x.level, code: x.code, message: row.message, ...(x.targetId ? { nodeId: x.targetId, layerName } : {}) } }
      })))
    }
    const rows = [...graphIssues.values()].flat().map((x) => x.row)
    update({ graphLint: rows, lintCount: lintTotal() })
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
    graphs.clear()
    if (dir) {
      const p = await loadProject(dir)
      meta = p.meta
      strict = p.meta.strictMode === true
      for (const [name, s] of Object.entries(p.swfs)) {
        const ir = Swf.parse(s.ir)
        initial[name] = ir
        overlays.set(ir.id, normalizeOverlay(s.overlay))
        graphs.set(name, new Map(Object.entries(s.graphs ?? {})))
      }
      const r = await readSnapshot(dir) // a missing or broken snapshot never stops the project from opening: builds use ir.json
      snapshot = r.snapshot ? snapshotInfo(r.snapshot, staleSwfs(r.snapshot, initial)) : r.error ? { updatedAt: '', swfs: 0, stale: [], error: r.error } : undefined
    } else {
      meta = undefined
      snapshot = undefined
    }
    projectDir = dir
    assets = createAssetStore(dir)
    pipeline = createBuildPipeline({
      ...cfg,
      assets,
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
      snapshotSource: () => snapshotSource,
      onSnapshot: (s) => {
        snapshot = snapshotInfo(s, [])
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
      assets,
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
    srv.events.on('hello', (h: SnapshotSource) => void (snapshotSource = h))
    srv.events.on('status', (s: { swfId?: string; state: 'compiling' | 'synced' | 'error'; issues?: { message: string; code?: string; nodeId?: string }[] }) => {
      if (s.swfId) buildBySwf.set(s.swfId, s.state === 'compiling' ? 'compiling' : s.issues?.some((i) => i.code === 'build_failed') ? 'failed' : 'done')
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
        lintCount: lintTotal(),
        unreachableNodes: [...unreachableBySwf.values()].flat()
      })
      void refreshGraphLint().catch(() => undefined) // a deleted layer can orphan a graph node
      pushProject()
    })
    srv.events.on('swfs', (infos: SwfInfo[], loose: Layer[]) => {
      looseCount = loose.length
      update({ swfCount: infos.length, orphanedCount: infos.filter((i) => i.orphaned).length, looseLayers: loose, lintCount: lintTotal() })
      void refreshGraphLint().catch(() => undefined)
      pushProject()
    })
    update({ swfCount: srv.swfs().length, server: 'listening', error: undefined, port: srv.port, token: srv.token, looseLayers: [] })
    refreshFfdec()
    await refreshGraphLint().catch(() => undefined)
  }

  /** Switch to `dir` (or to no project). Everything of the previous project is dropped. */
  async function open(dir: string | undefined): Promise<OpenResult> {
    await settingsReady
    const keep = server ? { port: server.port, token: server.token } : undefined
    try {
      await stopServer()
      reports.clear()
      buildBySwf.clear()
      previews.clear()
      lintBySwf.clear()
      graphIssues.clear()
      unreachableBySwf.clear()
      looseCount = 0
      update({ connections: 0, build: 'idle', buildError: undefined, lintCount: 0, fonts: [], lint: [], graphLint: [], timing: undefined, previewMs: undefined, unreachableNodes: [], connectionIssue: undefined })
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
        dir: p.dir, name: p.name, version: meta.version, modId: p.modId, deploy: meta.deploy, imageMode: meta.imageMode ?? 'embedded', assets, strictMode: p.strictMode,
        swfs: p.swfs.map((s) => ({
          name: s.name, orphaned: s.orphaned, kind: s.ir.target.kind, ir: s.ir,
          ...(buildBySwf.has(s.id) ? { build: { state: buildBySwf.get(s.id)!, lint: (reports.get(s.id)?.lint ?? []).map(({ severity, code, message, nodeId, layerName }) => ({ severity, code, message, nodeId, layerName })) } } : {}),
          ...(graphIssues.get(s.name)?.length ? { graphLint: graphIssues.get(s.name)!.map((x) => x.item) } : {}),
          ...(s.overlay.nodes ? { overlay: s.overlay.nodes } : {}),
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
    report: reportDeploy,
    ...(deps.chooseZip ? { chooseZip: deps.chooseZip } : {})
  })
  let lastZip: string | undefined // the only path "Open folder" may reveal: never a path from the renderer
  let writeQueue: Promise<void> = Promise.resolve()
  const viewSettings = async (): Promise<ResolvedSettings> => {
    await settingsReady
    const r = resolved()
    return { ...r, problems: await settingProblems(r) }
  }
  // INKWELL_FONTS_SANDBOX=<dir>: debug runs install into <dir> with a JSON "registry", never into the user's fonts or HKCU
  const fontsSandbox = process.env['INKWELL_FONTS_SANDBOX']
  const [winMajor = 0, , winBuild = 0] = release().split('.').map(Number)
  const fontTool = createFontTool({
    sys: fontsSandbox ? sandboxFontSystem(fontsSandbox) : windowsFontSystem(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')),
    platformOk: process.platform === 'win32' && (winMajor > 10 || (winMajor === 10 && winBuild >= 17763)), // per-user fonts: Windows 10 1809+
    findBsa: async () => {
      await settingsReady
      const sky: SkyrimFacts = {}
      await checkSkyrim(doctorCtx(), sky)
      return sky.bsa
    },
    ffdec: () => ({ javaPath: cfg.javaPath, ffdecDir: cfg.ffdecDir }),
    onProgress: (p) => deps.broadcast(IPC.fontsProgress, p)
  })
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
    deployCommit: async (token: string): Promise<DeployResult> => {
      const r = await deploy.commit(token)
      if (r.zipPath) lastZip = r.zipPath
      return r
    },
    lastPackage: (): string | undefined => lastZip,
    deployCancel: (): void => deploy.cancel(),
    fontStatus: () => fontTool.status(),
    installFonts: () => fontTool.install(),
    removeFonts: () => fontTool.remove(),
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
    getPacks,
    listGraphs(swf: string): GraphResult<{ graphs: GraphSummary[] }> {
      const m = graphs.get(swf)
      return m ? { ok: true, graphs: [...m.values()].map(summarize).sort((a, b) => a.id.localeCompare(b.id)) } : { ok: false, error: 'No such swf in the open project' }
    },
    async loadGraph(swf: string, id: string): Promise<GraphResult<{ graph: Graph }>> {
      if (!projectDir || !graphs.has(swf)) return { ok: false, error: 'No such swf in the open project' }
      return readGraph(projectDir, swf, id)
    },
    /** The renderer is the source of truth for open graphs (like overlays); main keeps the saved copy for validation. */
    async saveGraph(swf: string, doc: unknown): Promise<GraphResult> {
      const m = graphs.get(swf)
      if (!projectDir || !m) return { ok: false, error: 'No such swf in the open project' }
      const parsed = Graph.safeParse(doc)
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid graph' }
      const r = await writeGraph(projectDir, swf, parsed.data)
      if (r.ok) {
        m.set(parsed.data.id, parsed.data)
        await refreshGraphLint().catch(() => undefined)
      }
      return r
    },
    async createGraph(swf: string, name: string, scope: 'menu' | 'component'): Promise<GraphResult<{ graph: Graph }>> {
      const m = graphs.get(swf)
      if (!projectDir || !m) return { ok: false, error: 'No such swf in the open project' }
      if (scope === 'menu' && [...m.values()].some((g) => g.scope === 'menu')) return { ok: false, error: 'This SWF already has its menu graph' }
      const graph = emptyGraph(newGraphId(name, new Set(m.keys())), name, scope)
      const r = await writeGraph(projectDir, swf, graph)
      if (!r.ok) return r
      m.set(graph.id, graph)
      await refreshGraphLint().catch(() => undefined)
      return { ok: true, graph }
    },
    /** Removes the file only; the caller also removes the id from the overlay `scripts` (the renderer owns overlays). */
    async deleteGraph(swf: string, id: string): Promise<GraphResult> {
      const m = graphs.get(swf)
      if (!projectDir || !m) return { ok: false, error: 'No such swf in the open project' }
      const r = await deleteGraph(projectDir, swf, id)
      if (r.ok) {
        m.delete(id)
        await refreshGraphLint().catch(() => undefined)
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
