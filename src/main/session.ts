import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir, release } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Graph, Swf, type Localization, type MenuSettings } from '@inkwell-ui/spec'
import { bindingsOf } from '../shared/graphBinding'
import { newFunctionGraph } from '../shared/functions'
import { defIndex, isGraphId, newGraph, newGraphId, summarize, type GraphAs2, type GraphResult, type GraphSummary, type LoadedPack, type PackSet } from '../shared/graphs'
import { TOOL_VERSION } from '../shared/product'
import { validateGraph } from '../shared/graphValidate'
import { IPC, type SaveOverlayResult } from '../shared/ipc'
import { normalizeOverlay, type OverlayDoc } from '../shared/overlay'
import type { PreviewBuild, PreviewRendered } from '../shared/preview'
import type { OpenResult, ProjectState, RecentProject, SnapshotInfo } from '../shared/projectState'
import { flattenReports, type LintRow, type SwfReport, type SyncUiState } from '../shared/syncState'
import { ffdecState } from '../shared/ffdec'
import type { DeployLintItem, DeployResult, DeployScope, DeployState, DeployTargetId, DeployTargetInfo, PrepareResult } from '../shared/deploy'
import type { BenchmarkResult, BuildCacheResult, CheckId, CheckResult, DevLinkSettings, ResolvedSettings, SetSettingResult, SettingKey, StoredSettings } from '../shared/doctor'
import { buildCacheAction, runBenchmark, runDoctor, type DoctorContext } from './doctor'
import { checkSkyrim, type SkyrimFacts } from './doctor/checks'
import { createFontTool } from './fonts'
import { sandboxFontSystem, windowsFontSystem } from './fonts/install'
import { createDeployService } from './deploy/service'
import { resolveTarget } from './deploy/plan'
import { createDevClient, type ClientState } from './runtime/client'
import { generateToken, normalizeToken } from './runtime/devIni'
import { DEFAULT_PORT, resolveDevConfig } from './runtime/token'
import { initialDevState, reloadSummary, type DevReloadResult, type DevState } from '../shared/devLink'
import { createAssetStore, type AssetStore } from './images/assets'
import { createTrust } from './sync/figmaTrust'
import { loadSettings, normalizeValue, patchSettings, refuseReason, resolveSettings, saveSettings, settingProblems } from './settings'
import { defaultInstalledDir, modeFromEnv, resolvePreviewFonts, type PreviewFontSet } from './previewFonts'
import { corePackDir, loadPacks } from './packs'
import { addFunctionToLibrary, createLibrary, exportPack, importLibrary, isImportedPack, localLibraryDirs, removeLibrary, removeLibraryFunction, type ImportResult } from './packs/libraries'
import { createPackManager, lockedPacks, parseGitHubRef, readLock, type Fetch } from './packs/manager'
import type { PackCandidate, PackResult, PacksState } from '../shared/packs'
import { loadProject, type ProjectMeta } from './project'
import { writeMenuSettings } from './project/menuFile'
import { readLocalization, writeLocalization } from './project/localizationFile'
import { addFont, readFontBytes, readFonts, saveFontSettings, type ProjectFont } from './project/fontFiles'
import { analyzeFont, isCharsetId, licenseVerdict } from './fonts/embed'
import { fsTypeLabel } from './fonts/convert'
import type { AddFontOutcome, ProjectFontInfo, ProjectFontsState } from '../shared/fonts'
import { deleteGraph, readGraph, writeGraph } from './project/graphFiles'
import { writeOverlay } from './project/overlayFile'
import { addRecent, loadRecent, saveRecent } from './project/recent'
import { writeProjectSetting } from './project/settings'
import { MOD_ID, modIdProblem } from '../shared/modId'
import { readSnapshot, staleSwfs, type FigmaSnapshot, type SnapshotSource } from './project/snapshot'
import { generate } from './swf/generate'
import { loadCodegenPacks } from './codegen/packs'
import { createBuildPipeline } from './sync/buildPipeline'
import { contractsDir, layersProblem, loadContracts } from './lint/contract'
import { startSyncServer, type Layer, type SwfInfo } from './sync/syncServer'

export interface SessionDeps {
  appPath: string
  userData: string
  editorVersion: string
  /** Sends `payload` on `channel` to every window. */
  broadcast(channel: string, payload: unknown): void
  /** Native save dialog for a package zip (index.ts); undefined = cancelled. */
  chooseZip?(defaultPath: string): Promise<string | undefined>
  /** Pack downloads (tests inject one); default: the global fetch. */
  fetch?: Fetch
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
  let localization: { localization?: Localization; error?: string } = {} // localization.json (V2.3): the tab is the writer; main keeps the saved copy for deploy
  const previewThemes = new Map<string, string>() // swf id -> theme mode the stage toolbar previews (not saved)
  const menus = new Map<string, { settings?: MenuSettings; error?: string }>() // swf name -> swfs/<name>/menu.json (the panel is the writer; main keeps the saved copy for deploy)
  let packs: Promise<PackSet> | undefined
  /** The bundled core pack first (it wins an id clash), then the project's cached packs that match packs.lock (`refreshPacks`). */
  let packDirs = [corePackDir(deps.appPath)]
  const originOf = (d: string): LoadedPack['origin'] => (d === corePackDir(deps.appPath) ? 'core' : /[\\/]libraries[\\/]/.test(d) ? (isImportedPack(d) ? 'imported' : 'library') : 'installed')
  const getPacks = (): Promise<PackSet> => (packs ??= loadPacks(packDirs, originOf))
  let codegenPacks: ReturnType<typeof loadCodegenPacks> | undefined
  const packManager = createPackManager({ fetch: deps.fetch ?? fetch, ...(process.env['INKWELL_PACKS_INDEX'] ? { indexUrl: process.env['INKWELL_PACKS_INDEX'] } : {}) })
  /** Re-reads packs.lock and the cache; every pack consumer (lint, preview builds, AS2 view, deploy) loads again on next use. */
  const refreshPacks = async (dir: string | undefined): Promise<void> => {
    packDirs = [corePackDir(deps.appPath), ...(dir ? (await lockedPacks(dir, (await readLock(dir)).lock)).dirs : []), ...(dir ? await localLibraryDirs(dir) : [])]
    packs = undefined
    codegenPacks = undefined
    pipeline?.resetPacks()
  }
  /** Overlay without mock data: mock data is delivered to Ruffle live and never needs a build. */
  const withoutMock = (d: OverlayDoc | undefined): string => JSON.stringify({ ...d, mockData: undefined })
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
  // Figma bridge trust (protocol 4): lives for the whole editor session, so a denial and the prompt rate limit survive opening another project
  let approval: { id: number; resolve(allow: boolean): void } | undefined
  let approvalSeq = 0
  const trust = createTrust({
    store: {
      hashes: () => stored.figmaPlugins ?? [],
      add: async (h) => {
        await settingsReady
        stored = { ...stored, figmaPlugins: [...(stored.figmaPlugins ?? []), h] }
        await saveSettings(settingsFile, stored)
      }
    },
    ask: (req, signal) =>
      new Promise<boolean>((resolve) => {
        const id = ++approvalSeq
        const done = (allow: boolean): void => {
          if (approval?.id !== id) return
          approval = undefined
          update({ approval: undefined })
          resolve(allow)
        }
        approval = { id, resolve: done }
        signal.addEventListener('abort', () => done(false), { once: true })
        update({ approval: { id, ...req } })
      })
  })
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
        return ir ? [{ id: i.id, name: i.name, orphaned: i.orphaned, ir, overlay: overlays.get(i.id) ?? normalizeOverlay({}), ...(menus.get(i.name)?.settings ? { menu: menus.get(i.name)!.settings! } : {}), ...(menus.get(i.name)?.error ? { menuError: menus.get(i.name)!.error! } : {}), ...(previewThemes.has(i.id) ? { previewTheme: previewThemes.get(i.id)! } : {}) }] : []
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    return { dir: projectDir, name: meta.name, modId: meta.modId, strictMode: strict, swfs, ...(snapshot ? { snapshot } : {}) }
  }
  /** Graph issues of every built SWF as lint rows and deploy items: the single place graphs are validated for the Lint dock and the export gate. */
  const graphIssues = new Map<string, { row: LintRow; item: DeployLintItem }[]>() // swf name -> issues
  const lintTotal = (): number => [...lintBySwf.values()].reduce((a, b) => a + b, 0) + looseCount + [...graphIssues.values()].reduce((a, b) => a + b.length, 0)
  async function refreshGraphLint(): Promise<void> {
    const defs = defIndex(await getPacks())
    const library = (await (codegenPacks ??= loadCodegenPacks(packDirs))).packs.functions ?? new Map<string, Graph>()
    graphIssues.clear()
    for (const i of server?.swfs() ?? []) {
      const ir = i.orphaned ? undefined : server?.ir(i.id)
      const all = [...(graphs.get(i.name)?.values() ?? [])]
      if (!ir || !all.length) continue
      const layers = new Set(Object.keys(ir.nodes))
      graphIssues.set(i.name, all.flatMap((g) => validateGraph(g, { defs, layers, siblings: all, library, target: ir.target.kind, ...(ir.target.contract ? { contract: ir.target.contract } : {}) }).map((x) => {
        const layerName = x.targetId ? (ir.nodes[x.targetId]?.name ?? x.targetId) : ''
        const row: LintRow = { swfName: i.name, nodeId: x.targetId ?? '', layerName, severity: x.level, code: x.code, message: `${g.name}: ${x.message}`, graphId: g.id, graphNodeId: x.nodeId! }
        return { row, item: { severity: x.level, code: x.code, message: row.message, ...(x.targetId ? { nodeId: x.targetId, layerName } : {}) } }
      })))
    }
    const rows = [...graphIssues.values()].flat().map((x) => x.row)
    update({ graphLint: rows, lintCount: lintTotal() })
  }
  /** After an install or restore: the new pack set reaches lint and every SWF's build (a graph may use the new nodes). */
  const afterPackChange = async <T extends { ok: boolean }>(r: T): Promise<T> => {
    if (!r.ok || !projectDir) return r
    await refreshPacks(projectDir)
    await refreshGraphLint().catch(() => undefined)
    server?.rebuildAll()
    return r
  }
  const rebuildSwf = (name: string): void => {
    const info = server?.swfs().find((i) => i.name === name)
    if (info && !info.orphaned) server!.rebuild(info.id)
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

  async function start(dir: string | undefined, keep?: { port: number }): Promise<void> {
    const initial: Record<string, Swf> = {}
    overlays.clear()
    graphs.clear()
    menus.clear()
    localization = dir ? await readLocalization(dir) : {}
    if (dir) {
      const p = await loadProject(dir)
      meta = p.meta
      strict = p.meta.strictMode === true
      for (const [name, s] of Object.entries(p.swfs)) {
        const ir = Swf.parse(s.ir)
        initial[name] = ir
        overlays.set(ir.id, normalizeOverlay(s.overlay))
        graphs.set(name, new Map(Object.entries(s.graphs ?? {})))
        if (s.menu || s.menuError) menus.set(name, { ...(s.menu ? { settings: s.menu } : {}), ...(s.menuError ? { error: s.menuError } : {}) })
      }
      const r = await readSnapshot(dir) // a missing or broken snapshot never stops the project from opening: builds use ir.json
      snapshot = r.snapshot ? snapshotInfo(r.snapshot, staleSwfs(r.snapshot, initial)) : r.error ? { updatedAt: '', swfs: 0, stale: [], error: r.error } : undefined
    } else {
      meta = undefined
      snapshot = undefined
    }
    projectDir = dir
    packManager.clear()
    await refreshPacks(dir)
    assets = createAssetStore(dir)
    pipeline = createBuildPipeline({
      ...cfg,
      assets,
      previewFonts: fonts(),
      themeFor: (name, swfId) => ({ ...(menus.get(name)?.settings?.userDefaults?.theme ? { default: menus.get(name)!.settings!.userDefaults!.theme! } : {}), ...(previewThemes.has(swfId) ? { preview: previewThemes.get(swfId)! } : {}) }),
      devBuild: () => link().deploy === true,
      onDevBuild: (n) => void devFresh.add(n),
      get packDirs(): string[] { return packDirs },
      contractsDir: contractsDir(deps.appPath),
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
      trust,
      initial,
      strict: () => strict,
      assets,
      onChange: (id: string, ir: Swf, name: string) => {
        if (failBuilds) throw new Error('Injected build failure (screenshot driver)')
        return pl.onChange(id, ir, name)
      }
    }
    // same port as before, so the Figma plugin only has to reconnect; if the port is taken, the first free default
    const srv = await (keep ? startSyncServer({ ...opts, ports: [keep.port] }).catch(() => startSyncServer(opts)) : startSyncServer(opts))
    server = srv
    srv.events.on('connections', (connections: number) => update({ connections, ...(connections > 0 ? { connectionIssue: undefined } : {}) }))
    srv.events.on('handshakeFailed', (message: string) => update({ connectionIssue: { kind: 'version', message } }))
    srv.events.on('rejected', () =>
      update({ connectionIssue: { kind: 'auth', message: 'Connection from a disallowed origin was refused.' } })
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
    srv.events.on('swfs', (infos: SwfInfo[], loose: Layer[], components: Layer[]) => {
      looseCount = loose.length
      update({ swfCount: infos.length, orphanedCount: infos.filter((i) => i.orphaned).length, looseLayers: loose, pageComponents: components, lintCount: lintTotal() })
      void refreshGraphLint().catch(() => undefined)
      pushProject()
    })
    update({ swfCount: srv.swfs().length, server: 'listening', error: undefined, port: srv.port, looseLayers: [], pageComponents: [] })
    refreshFfdec()
    await refreshGraphLint().catch(() => undefined)
  }

  /** Switch to `dir` (or to no project). Everything of the previous project is dropped. */
  async function open(dir: string | undefined): Promise<OpenResult> {
    await settingsReady
    const keep = server ? { port: server.port } : undefined
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
      devClient.stop()
      devFresh.clear()
      if (dir && !devUserOff) devClient.start()
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

  // ---- the game dev connection (docs/dev-mode.md) ----
  const linkKey = (): string | undefined => (projectDir ? resolve(projectDir).toLowerCase() : undefined)
  const link = (): DevLinkSettings => (linkKey() ? stored.devLinks?.[linkKey()!] : undefined) ?? {}
  const patchLink = async (patch: Partial<DevLinkSettings>, remove: (keyof DevLinkSettings)[] = []): Promise<void> => {
    const k = linkKey()
    if (!k) return
    await settingsReady
    const cur: DevLinkSettings = { ...stored.devLinks?.[k], ...patch }
    for (const r of remove) delete cur[r]
    stored = { ...stored, devLinks: { ...stored.devLinks, [k]: cur } }
    await saveSettings(settingsFile, stored)
  }
  let devUserOff = false // the user pressed Disconnect: no automatic connecting until Connect or a new token
  const { devDeploy: _d, ...initialClient } = initialDevState()
  let devClientState: ClientState = initialClient
  const devState = (): DevState => ({ ...devClientState, devDeploy: link().deploy === true })
  const pushDev = (): void => deps.broadcast(IPC.devState, devState())
  const deployRoot = (): string | undefined => {
    const p = projectState()
    if (!p || !meta) return undefined
    const t = resolveTarget('mo2Mod', resolved(), { dir: p.dir, name: p.name, modId: p.modId, ...(meta.deploy ? { deploy: meta.deploy } : {}) })
    return 'root' in t ? t.root : undefined
  }
  const devClient = createDevClient({
    editorVersion: deps.editorVersion,
    resolveConfig: async () => {
      await settingsReady
      if (!projectDir) return undefined
      const r = resolved()
      const root = deployRoot()
      return resolveDevConfig({ link: link(), ...(r.mo2OverwriteDir ? { overwriteDir: r.mo2OverwriteDir } : {}), ...(root ? { deployRoot: root } : {}) })
    },
    onState: (s) => {
      devClientState = s
      pushDev()
    },
    onEvents: (e) => deps.broadcast(IPC.devEvents, e)
  })
  /** The dev SWFs (`<name>.dev.swf`) that are current; cleared when the toggle changes or a project opens, because only a build with the toggle on makes them. */
  const devFresh = new Set<string>()
  /** A deploy never fails with "not built": a custom menu without a finished build (or, for a Dev deploy, without a current dev build) is built first. */
  const ensureBuilds = async (dev: boolean): Promise<void> => {
    // a rebuild the last edit started (a saved graph) finishes first, so the deploy ships it
    for (let n = 0; n < 600 && [...buildBySwf.values()].includes('compiling'); n++) await new Promise((r) => setTimeout(r, 100))
    for (const i of server?.swfs() ?? []) {
      const ir = i.orphaned ? undefined : server?.ir(i.id)
      const kind = ir?.target.kind // a menu replacement builds too: its build lint carries the contract check (export gate)
      if (!ir || (kind !== 'customMenu' && kind !== 'menuReplacement') || (buildBySwf.get(i.id) === 'done' && (!dev || kind !== 'customMenu' || devFresh.has(i.name)))) continue
      buildBySwf.set(i.id, 'compiling')
      try {
        await pipeline!.onChange(i.id, ir, i.name)
        buildBySwf.set(i.id, 'done')
      } catch (e) {
        buildBySwf.set(i.id, 'failed')
        throw e
      }
    }
  }
  /** Hot reload after a Dev deploy (S6: the editor deploys first, then sends `reload`): one request per deployed menu. */
  async function reloadAfterDeploy(menus: string[]): Promise<string> {
    if (devClient.state().phase !== 'connected') return 'hot reload skipped: the game is not connected (start Skyrim with Dev Mode, then use Trigger Hot Reload)'
    const rs: DevReloadResult[] = []
    for (const m of menus) rs.push(await devClient.reload(m))
    const bad = rs.find((r) => !r.ok)
    return reloadSummary({
      ok: !bad, reloaded: rs.flatMap((r) => r.reloaded), skipped: rs.flatMap((r) => r.skipped), ms: rs.reduce((a, r) => a + r.ms, 0), ...(bad?.error ? { error: bad.error } : {})
    })
  }

  /** What the Inspector shows about one project font: licence verdict (V5.3), size, glyphs. */
  async function fontInfo(dir: string, f: ProjectFont): Promise<ProjectFontInfo> {
    const base = { hash: f.hash, family: f.family, ...(f.source ? { source: f.source } : {}), charsets: f.charsets, extraChars: f.extraChars }
    const bytes = await readFontBytes(dir, f.hash)
    if (!bytes) return { ...base, fsType: 0, fsTypeLabel: '', license: { level: 'error', text: 'the font file is missing' }, glyphCount: 0, bytes: 0, error: `fonts/${f.hash}.ttf is missing` }
    try {
      const i = analyzeFont(bytes)
      const v = licenseVerdict(i.fsType)
      return {
        ...base, family: i.family, fsType: i.fsType, fsTypeLabel: fsTypeLabel(i.fsType), glyphCount: i.glyphCount, bytes: i.bytes, ...(i.licenseText ? { licenseText: i.licenseText } : {}),
        license: v.error ? { level: 'error', text: v.error.text } : v.warning ? { level: 'warning', text: v.warning.text } : { level: 'ok' }
      }
    } catch (e) {
      return { ...base, fsType: 0, fsTypeLabel: '', license: { level: 'error', text: 'the file is not a usable TrueType font' }, glyphCount: 0, bytes: bytes.length, error: e instanceof Error ? e.message : String(e) }
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
        dir: p.dir, name: p.name, version: meta.version, modId: p.modId, deploy: meta.deploy, imageMode: meta.imageMode ?? 'embedded', assets, strictMode: p.strictMode, ...(localization.localization ? { localization: localization.localization } : {}),
        swfs: p.swfs.map((s) => ({
          name: s.name, orphaned: s.orphaned, kind: s.ir.target.kind, ir: s.ir,
          ...(buildBySwf.has(s.id) ? { build: { state: buildBySwf.get(s.id)!, lint: (reports.get(s.id)?.lint ?? []).map(({ severity, code, message, nodeId, layerName }) => ({ severity, code, message, nodeId, layerName })) } } : {}),
          ...(menus.get(s.name)?.settings ? { menu: menus.get(s.name)!.settings! } : {}),
          ...(menus.get(s.name)?.error ? { menuError: menus.get(s.name)!.error! } : {}),
          ...(graphs.get(s.name)?.size ? { graphs: [...graphs.get(s.name)!.values()] } : {}),
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
    dev: () => {
      const l = link()
      return l.deploy && l.token ? { token: l.token, port: l.port ?? DEFAULT_PORT } : undefined
    },
    ensureBuilds,
    packDirs: () => packDirs,
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
    answerFigmaApproval: (id: number, allow: boolean): void => {
      if (approval?.id === id) approval.resolve(allow)
    },
    figmaPluginCount: async (): Promise<number> => (await settingsReady, stored.figmaPlugins?.length ?? 0),
    /** Revokes every approved plugin and drops the open connections (they must ask again). */
    async forgetFigmaPlugins(): Promise<{ ok: true } | { ok: false; error: string }> {
      await settingsReady
      const prev = stored
      const { figmaPlugins: _gone, ...rest } = stored
      stored = rest
      try {
        await saveSettings(settingsFile, stored)
      } catch (e) {
        stored = prev
        return { ok: false, error: `The settings could not be saved to ${settingsFile}: ${e instanceof Error ? e.message : String(e)}` }
      }
      server?.dropAll()
      return { ok: true }
    },
    /** Select (or focus) a layer in Figma through the approved connected plugin; the reason when no plugin got the request. */
    selectInFigma(nodeId: string, focus: boolean): { ok: true } | { ok: false; error: string } {
      return (server?.selectNode(nodeId, focus === true) ?? 0) > 0 ? { ok: true } : { ok: false, error: 'No approved Figma plugin is connected.' }
    },
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
      if (r.ok && r.devMenus) {
        const hot = await reloadAfterDeploy(r.devMenus)
        r.hotReload = hot
        if (state.deploy) update({ deploy: { ...state.deploy, hotReload: hot }, deploySeq: ++deployState })
        if (devClient.isWanted() && devClient.state().phase !== 'connected') devClient.configChanged() // the INI just written may hold the token the connection lacked
      }
      return r
    },
    lastPackage: (): string | undefined => lastZip,
    devState,
    devConnect: (): void => {
      devUserOff = false
      devClient.start()
    },
    devDisconnect: (): void => {
      devUserOff = true
      devClient.stop()
    },
    async devSetToken(raw: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
      if (!projectDir) return { ok: false, error: 'Open a project first.' }
      if (raw === null || raw.trim() === '') await patchLink({}, ['pasted'])
      else {
        const t = normalizeToken(raw)
        if (!t) return { ok: false, error: 'A token is 64 hexadecimal digits (0-9, a-f), as in the [Dev] Token= line of Inkwell.ini.' }
        await patchLink({ pasted: t })
      }
      devUserOff = false
      devClient.start()
      devClient.configChanged()
      pushDev()
      return { ok: true }
    },
    async devSetPort(port: number): Promise<{ ok: true } | { ok: false; error: string }> {
      if (!projectDir) return { ok: false, error: 'Open a project first.' }
      if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, error: 'The port is a whole number from 1024 to 65535 (the runtime default is 8788).' }
      await patchLink({ port })
      devClient.configChanged()
      pushDev()
      return { ok: true }
    },
    async devSetDeploy(on: boolean): Promise<void> {
      if (!projectDir) return
      if (on) await patchLink({ deploy: true, ...(link().token ? {} : { token: generateToken() }) }) // one token per project, made once and kept in the user settings
      else await patchLink({}, ['deploy'])
      devFresh.clear()
      pushDev()
      if (on) server?.rebuildAll() // the dev SWFs are built with the next builds; a Dev deploy that comes first builds them itself
    },
    devReload: (menu?: string): Promise<DevReloadResult> => devClient.reload(menu),
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
        const next = normalizeOverlay(doc)
        const changed = withoutMock(overlays.get(info.id)) !== withoutMock(next)
        overlays.set(info.id, next)
        if (changed) server!.rebuild(info.id) // instance names and data bindings feed the compiler
      }
      return r
    },
    /** Theme mode the stage toolbar previews ('' = the menu's default); rebuilds that SWF. */
    setPreviewTheme(swfName: string, mode: string): { ok: boolean } {
      const info = server?.swfs().find((i) => i.name === swfName)
      if (!info) return { ok: false }
      if (mode) previewThemes.set(info.id, mode)
      else previewThemes.delete(info.id)
      server!.rebuild(info.id)
      return { ok: true }
    },
    /** Target of one swf (Target dialog); the build rewrites ir.json. A menu replacement also takes its contract and layers (W5), checked here (IPC input). */
    async setTarget(swfName: string, kind: unknown, more: { contract?: unknown; layers?: unknown } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
      if (kind !== 'hudWidget' && kind !== 'customMenu' && kind !== 'menuReplacement') return { ok: false, error: `Unknown target ${String(kind)}` }
      const { contract, layers } = more ?? {}
      if (contract !== undefined && (typeof contract !== 'string' || !/^[A-Za-z0-9_]{0,64}$/.test(contract))) return { ok: false, error: 'A contract name is letters, digits and _' }
      if (layers !== undefined && (!Array.isArray(layers) || !layers.every((l) => typeof l === 'string'))) return { ok: false, error: 'Layers must be a list of names' }
      const bad = Array.isArray(layers) && layers.length ? layersProblem(layers as string[]) : undefined
      if (bad) return { ok: false, error: bad }
      const info = server?.swfs().find((i) => i.name === swfName)
      if (!info || !server?.setTarget(info.id, kind, { ...(contract !== undefined ? { contract: contract as string } : {}), ...(layers !== undefined ? { layers: layers as string[] } : {}) })) return { ok: false, error: 'No such swf in the open project' }
      return { ok: true }
    },
    /** The contracts the editor ships (menu name and its layer names), for the target dialog's menu replacement fields. */
    async listContracts(): Promise<{ menu: string; layers: string[] }[]> {
      const all = await loadContracts(contractsDir(deps.appPath)).catch(() => [])
      return [...new Set(all.map((l) => l.menu))].sort().map((menu) => ({ menu, layers: all.filter((l) => l.menu === menu).map((l) => l.layer) }))
    },
    /** menu.json of a custom menu (Menu settings panel). Refused while an unreadable file sits there. */
    async saveMenuSettings(swfName: string, doc: unknown): Promise<SaveOverlayResult> {
      if (!projectDir || !server?.swfs().some((i) => i.name === swfName)) return { ok: false, error: 'No such swf in the open project' }
      const prev = menus.get(swfName)
      if (prev?.error) return { ok: false, error: `menu.json could not be read (${prev.error}); fix or delete it first.` }
      const r = await writeMenuSettings(projectDir, swfName, doc)
      if (!r.ok) return r
      menus.set(swfName, { settings: r.settings })
      const info = server.swfs().find((i) => i.name === swfName)
      if (info && prev?.settings?.userDefaults?.theme !== r.settings.userDefaults?.theme) server.rebuild(info.id) // the default theme is baked into the SWF
      pushProject()
      return { ok: true }
    },
    /** Embedded custom fonts of the project (Inspector, V5). */
    async getProjectFonts(): Promise<ProjectFontsState> {
      if (!projectDir) return { fonts: [] }
      const r = await readFonts(projectDir)
      return { fonts: await Promise.all(r.fonts.map((f) => fontInfo(projectDir!, f))), ...(r.error ? { error: r.error } : {}) }
    },
    async addProjectFontFile(path: string): Promise<AddFontOutcome> {
      if (!projectDir) return { ok: false, error: 'No project is open' }
      const bytes = await readFile(path).catch((e: unknown) => e instanceof Error ? e : new Error(String(e)))
      if (bytes instanceof Error) return { ok: false, error: bytes.message }
      const r = await addFont(projectDir, bytes, basename(path))
      if (!r.ok) return r
      server?.rebuildAll()
      return { ok: true, font: await fontInfo(projectDir, r.font), existed: r.existed }
    },
    async saveProjectFontSettings(hash: string, settings: { charsets: string[]; extraChars: string }): Promise<SaveOverlayResult> {
      if (!projectDir) return { ok: false, error: 'No project is open' }
      const r = await saveFontSettings(projectDir, hash, { charsets: settings.charsets.filter(isCharsetId), extraChars: settings.extraChars })
      if (r.ok) server?.rebuildAll() // the characters to embed changed
      return r
    },
    /** localization.json (Localization tab): the table, or the reason it cannot be read. */
    getLocalization: (): { localization: Localization | null; error?: string; modId: string } => ({ localization: localization.localization ?? null, ...(localization.error ? { error: localization.error } : {}), modId: meta?.modId ?? '' }),
    async saveLocalization(doc: unknown): Promise<SaveOverlayResult> {
      if (!projectDir) return { ok: false, error: 'No project is open' }
      if (localization.error) return { ok: false, error: `localization.json could not be read (${localization.error}); fix or delete it first.` }
      const r = await writeLocalization(projectDir, doc)
      if (!r.ok) return r
      localization = { localization: r.localization }
      return { ok: true }
    },
    getPacks,
    /**
     * Library functions (docs/functions.md): export the SWF's functions you ticked as a pack folder + zip in `outDir`; import a pack folder or zip into `<project>/libraries/<id>/`
     * (an existing id answers `exists` and is replaced with `replace`); remove one; save an edited library function back into its pack folder.
     */
    async libraryCreate(pack: { id: string; version: string; description?: string; credits?: string }) {
      if (!projectDir) return { ok: false as const, error: 'No project is open.' }
      return afterPackChange(await createLibrary(projectDir, pack, TOOL_VERSION))
    },
    async libraryAddFunction(packId: string, doc: unknown) {
      const parsed = Graph.safeParse(doc)
      if (!projectDir || !parsed.success || parsed.data.scope !== 'function') return { ok: false as const, error: parsed.success ? 'No project is open.' : (parsed.error.issues[0]?.message ?? 'Invalid graph') }
      return afterPackChange(await addFunctionToLibrary(projectDir, packId, parsed.data))
    },
    async libraryExport(packId: string, version: string | undefined, outDir: string) {
      if (!projectDir) return { ok: false as const, error: 'No project is open.' }
      const set = await getPacks()
      const library = (await (codegenPacks ??= loadCodegenPacks(packDirs))).packs.functions ?? new Map<string, Graph>()
      return exportPack({
        projectDir, packId, ...(version ? { version } : {}), defs: defIndex(set), library,
        packVersions: new Map(set.packs.map((p) => [p.manifest.id, p.manifest.version])), toolVersion: TOOL_VERSION, outDir
      })
    },
    async libraryImport(src: string, replace?: boolean): Promise<Awaited<ReturnType<typeof importLibrary>>> {
      if (!projectDir) return { ok: false, error: 'No project is open.' }
      return afterPackChange(await importLibrary(projectDir, src, replace ? { replace: true } : {}))
    },
    async libraryRemoveFunction(packId: string, fnId: string) {
      if (!projectDir) return { ok: false as const, error: 'No project is open.' }
      return afterPackChange(await removeLibraryFunction(projectDir, packId, fnId))
    },
    async libraryRemove(id: string) {
      if (!projectDir) return { ok: false as const, error: 'No project is open.' }
      return afterPackChange(await removeLibrary(projectDir, id))
    },
    async saveLibraryFunction(packId: string, doc: unknown): Promise<GraphResult> {
      const parsed = Graph.safeParse(doc)
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid graph' }
      const g = parsed.data
      const set = await getPacks()
      const pack = set.packs.find((p) => p.manifest.id === packId)
      const dir = pack?.dir
      const fnId = g.id.startsWith(`${packId}/`) ? g.id.slice(packId.length + 1) : g.id
      if (!pack || !dir || pack.origin !== 'library' || !isGraphId(fnId) || g.scope !== 'function') return { ok: false, error: `The library "${packId}" cannot be edited.` }
      try {
        await writeFile(join(dir, 'functions', `${fnId}.json`), JSON.stringify({ ...g, id: fnId }, null, 2) + '\n')
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      return afterPackChange({ ok: true as const })
    },
    /** Library tab > Packs (docs/graphs.md, Downloaded packs): state, index search, add by GitHub ref, install after the dialog, restore from packs.lock, check updates. Never reject. */
    packsState: async (): Promise<PacksState> => (projectDir ? packManager.state(projectDir) : { locked: [] }),
    packsIndex: () => packManager.index(),
    async packsResolve(input: string): Promise<PackResult<{ candidate: PackCandidate }>> {
      if (!projectDir) return { ok: false, error: 'No project is open.' }
      const ref = parseGitHubRef(input)
      return ref ? packManager.resolve(projectDir, ref) : { ok: false, error: 'Not a GitHub repository: use owner/name or https://github.com/owner/name.' }
    },
    async packsInstall(token: string): Promise<PackResult> {
      if (!projectDir) return { ok: false, error: 'No project is open.' }
      return afterPackChange(await packManager.install(projectDir, token))
    },
    async packsRestore(): Promise<PackResult<{ restored: string[]; errors: string[] }>> {
      if (!projectDir) return { ok: false, error: 'No project is open.' }
      return afterPackChange(await packManager.restore(projectDir))
    },
    packsCheckUpdates: async (): Promise<PackResult<{ updates: PackCandidate[]; errors: string[] }>> => (projectDir ? packManager.checkUpdates(projectDir) : { ok: false, error: 'No project is open.' }),
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
      if (JSON.stringify(m.get(parsed.data.id)) === JSON.stringify(parsed.data)) return { ok: true } // unchanged: no write, no rebuild
      const r = await writeGraph(projectDir, swf, parsed.data)
      if (r.ok) {
        m.set(parsed.data.id, parsed.data)
        await refreshGraphLint().catch(() => undefined)
        rebuildSwf(swf) // the Ruffle preview runs the graphs: a graph edit is a preview edit
      }
      return r
    },
    /** The AS2 class of one open graph (AS2 split view): codegen only, the same code a build runs; the graph is the editor's current copy, not necessarily saved. */
    async graphAs2(swf: string, doc: unknown): Promise<GraphResult<{ as2: GraphAs2 }>> {
      const info = server?.swfs().find((i) => i.name === swf)
      const ir = info && !info.orphaned ? server?.ir(info.id) : undefined
      if (!info || !ir || !meta) return { ok: false, error: 'No such swf in the open project' }
      const parsed = Graph.safeParse(doc)
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid graph' }
      const live = parsed.data
      const all = [live, ...[...(graphs.get(swf)?.values() ?? [])].filter((g) => g.id !== live.id)]
      try {
        const cg = await (codegenPacks ??= loadCodegenPacks(packDirs))
        const nodes = overlays.get(info.id)?.nodes ?? {}
        const instanceNames = Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (typeof o.instanceName === 'string' && o.instanceName ? [[id, o.instanceName]] : [])))
        const out = generate(ir, { modId: meta.modId, instanceNames, graphs: { graphs: all, packs: cg.packs }, bindings: bindingsOf(nodes) })
        const c = out.graphClasses.find((x) => x.graphId === live.id)
        if (!c) return { ok: false, error: 'No code was generated for this graph' }
        return { ok: true, as2: { source: c.source, lines: c.map.lines } }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    async createGraph(swf: string, name: string, scope: Graph['scope']): Promise<GraphResult<{ graph: Graph }>> {
      const m = graphs.get(swf)
      if (!projectDir || !m) return { ok: false, error: 'No such swf in the open project' }
      if (scope === 'menu' && [...m.values()].some((g) => g.scope === 'menu')) return { ok: false, error: 'This SWF already has its menu graph' }
      const id = newGraphId(name, new Set(m.keys()))
      const graph = scope === 'function' ? newFunctionGraph(id, name) : newGraph(id, name, scope)
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
        rebuildSwf(swf)
      }
      return r
    },
    /** Discards an orphaned SWF: its folder moves to `<project>/.trash/<name>-<time>` (restorable by hand), nothing is deleted. */
    async discardSwf(swfId: string): Promise<{ ok: true; trash: string } | { ok: false; error: string }> {
      const info = server?.swfs().find((i) => i.id === swfId)
      if (!projectDir || !info?.orphaned) return { ok: false, error: 'Only an orphaned SWF can be discarded' }
      const trash = join(projectDir, '.trash', `${info.name}-${Date.now()}`)
      try {
        await mkdir(join(projectDir, '.trash'), { recursive: true })
        await rename(join(projectDir, 'swfs', info.name), trash)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      for (const m of [overlays, lintBySwf, unreachableBySwf, reports, buildBySwf, previews] as Map<string, unknown>[]) m.delete(swfId)
      graphs.delete(info.name)
      menus.delete(info.name)
      server!.forget(swfId) // its 'swfs' event refreshes the counts, lint and the project push
      return { ok: true, trash }
    },
    /** The Mod id field (Settings > Project): letters and digits, starting with a letter (shared/modId.ts). Refused, not cleaned: the field shows why. */
    async setModId(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
      if (!projectDir || !meta) return { ok: false, error: 'No project is open.' }
      if (typeof id !== 'string' || !MOD_ID.test(id)) return { ok: false, error: modIdProblem(String(id)) ?? 'Invalid mod id.' }
      if (id === meta.modId) return { ok: true }
      await writeProjectSetting(projectDir, 'modId', id)
      meta = { ...meta, modId: id }
      pipeline?.setModId(id)
      server?.rebuildAll()
      pushProjectNow()
      return { ok: true }
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
      devClient.stop()
      await stopServer()
    }
  }
}
