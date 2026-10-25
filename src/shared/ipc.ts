import type { DeployResult, DeployScope, DeployTargetId, DeployTargetInfo, PrepareResult } from './deploy'
import type { BenchmarkResult, BuildCacheResult, CheckId, CheckResult, PathSettingKey, ResolvedSettings, SetSettingResult, SettingKey } from './doctor'
import type { FontToolProgress, FontToolResult, FontToolStatus } from './fonts'
import type { Graph } from '@inkwell-ui/spec'
import type { GraphResult, GraphSummary, PackSet } from './graphs'
import type { OverlayDoc } from './overlay'
import type { PreviewBuild, PreviewFontBlob, PreviewRendered } from './preview'
import type { OpenResult, ProjectState, RecentProject, UiEvent } from './projectState'
import type { SyncUiState } from './syncState'

/** Channel names, used by main and preload only. */
export const IPC = {
  syncGet: 'sync:get',
  syncUpdate: 'sync:update',
  previewGet: 'preview:get',
  previewBuild: 'preview:build',
  previewRendered: 'preview:rendered',
  previewFonts: 'preview:fonts',
  projectGet: 'project:get',
  projectUpdate: 'project:update',
  projectNew: 'project:new',
  projectOpen: 'project:open',
  projectExample: 'project:example',
  projectRecent: 'project:recent',
  overlaySave: 'overlay:save',
  graphsList: 'graphs:list',
  graphsLoad: 'graphs:load',
  graphsSave: 'graphs:save',
  graphsCreate: 'graphs:create',
  graphsDelete: 'graphs:delete',
  packsGet: 'packs:get',
  strictSet: 'project:strict',
  buildAll: 'build:all',
  previewDetach: 'preview:detach',
  previewDetached: 'preview:detached',
  uiEvent: 'ui:event',
  figmaSelection: 'figma:selection',
  menuSettings: 'menu:settings',
  doctorRun: 'doctor:run',
  doctorBenchmark: 'doctor:benchmark',
  doctorBuildCache: 'doctor:buildCache',
  doctorFirstLaunch: 'doctor:firstLaunch',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsBrowse: 'settings:browse',
  openExternal: 'app:openExternal',
  deployTargets: 'deploy:targets',
  deployPrepare: 'deploy:prepare',
  deployCommit: 'deploy:commit',
  deployCancel: 'deploy:cancel',
  packageReveal: 'package:reveal',
  fontsStatus: 'fonts:status',
  fontsInstall: 'fonts:install',
  fontsRemove: 'fonts:remove',
  fontsProgress: 'fonts:progress'
} as const

export type SaveOverlayResult = { ok: true } | { ok: false; error: string }

/** `window.inkwell`: the whole renderer-facing API. Every `on*` returns its unsubscribe function. */
export interface InkwellApi {
  getSync(): Promise<SyncUiState>
  onSync(cb: (s: SyncUiState) => void): () => void
  /** Latest preview build of every SWF (restores the preview after a reload). */
  getPreviewBuilds(): Promise<PreviewBuild[]>
  onPreviewBuild(cb: (b: PreviewBuild) => void): () => void
  /** Font files for the preview text (device fonts by name); the only place font bytes leave the main process. */
  getPreviewFonts(): Promise<PreviewFontBlob[]>
  /** Tells main how long the preview took (build received -> first frame). */
  reportPreviewRendered(r: PreviewRendered): void

  /** The open project (IR + overlays of every SWF), or null when none is open. */
  getProject(): Promise<ProjectState | null>
  onProject(cb: (p: ProjectState | null) => void): () => void
  /** Native folder dialog (titled `dialogTitle`, UI copy from the renderer), then an empty project there. */
  newProject(dialogTitle: string): Promise<OpenResult>
  /** Opens `dir`, or asks with a native folder dialog when omitted. */
  openProject(dir: string | undefined, dialogTitle: string): Promise<OpenResult>
  /** Native folder dialog, copies the sample project (samples/hud-minimal) there and opens it. */
  openExample(dialogTitle: string): Promise<OpenResult>
  getRecentProjects(): Promise<RecentProject[]>
  /** Writes `swfs/<swfName>/overlay.json` (validated; unknown keys kept as sent). */
  saveOverlay(swfName: string, overlay: OverlayDoc): Promise<SaveOverlayResult>
  /** Graphs of one SWF (`swfs/<swfName>/graphs/*.json`, docs/graphs.md): summaries, one graph, write (validated; unknown keys kept), create (an id is made from the name; one menu graph per SWF), delete. Never reject. */
  listGraphs(swfName: string): Promise<GraphResult<{ graphs: GraphSummary[] }>>
  loadGraph(swfName: string, id: string): Promise<GraphResult<{ graph: Graph }>>
  saveGraph(swfName: string, graph: Graph): Promise<GraphResult>
  createGraph(swfName: string, name: string, scope: Graph['scope']): Promise<GraphResult<{ graph: Graph }>>
  deleteGraph(swfName: string, id: string): Promise<GraphResult>
  /** Node definitions of the loaded packs (the bundled core pack today). Data only; `problems` lists files that failed their schema. */
  getPacks(): Promise<PackSet>
  /** Strict Mode, stored in project.json; rebuilds every SWF so the build status follows. */
  setStrictMode(on: boolean): Promise<void>
  /** Queues a build of every SWF that has a Figma frame; resolves with how many. */
  buildAll(): Promise<number>

  /** Pop out (true) or re-dock (false) the preview window. */
  setPreviewDetached(detached: boolean): Promise<void>
  getPreviewDetached(): Promise<boolean>
  onPreviewDetached(cb: (detached: boolean) => void): () => void
  /** Sent to the OTHER windows (selection, active SWF), so the detached preview and the main window agree. */
  sendUiEvent(e: UiEvent): void
  onUiEvent(cb: (e: UiEvent) => void): () => void
  /** The layers selected in Figma (the plugin's `selection` message). */
  onFigmaSelection(cb: (ids: string[]) => void): () => void
  /** Edit > Settings in the application menu. */
  onOpenSettings(cb: () => void): () => void

  /** Setup Doctor (UX 5.3): every check (or only `only`), in parallel; never rejects. */
  runDoctor(only?: CheckId[]): Promise<CheckResult[]>
  /** Cold CLI vs wrapper first job vs warm median on the test fixture. User-triggered. */
  runBenchmark(): Promise<BenchmarkResult>
  buildVanillaCache(): Promise<BuildCacheResult>
  /** True once, on the first launch where any check fails (main marks it as seen either way). */
  doctorFirstLaunch(): Promise<boolean>
  /** Settings as used (stored value, overridden by INKWELL_* variables, else default) with where each came from. */
  getSettings(): Promise<ResolvedSettings>
  /** `null` removes a stored value. Returns the settings as used afterwards, or the reason it was refused or could not be written. */
  setSetting(key: SettingKey, value: string | null): Promise<SetSettingResult>
  /** Native folder or file dialog (title from the renderer), stores the choice; `cancelled` when the dialog was closed. */
  browseSetting(key: PathSettingKey, folder: boolean, title: string): Promise<SetSettingResult>
  /** Opens an https page in the browser. */
  openExternal(url: string): Promise<void>

  /** Deploy targets of the open project with their exact paths (MO2 only; the others are listed with a reason). */
  getDeployTargets(): Promise<DeployTargetInfo[]>
  /** Compiles and checks everything for a deploy, writes nothing. `needsConfirm` is true for a folder not confirmed for this project yet. */
  prepareDeploy(target: DeployTargetId, scope: DeployScope, activeSwf?: string): Promise<PrepareResult>
  /** Writes what `prepareDeploy` returned a token for. */
  commitDeploy(token: string): Promise<DeployResult>
  cancelDeploy(): Promise<void>
  /** Shows the last package zip written in this session in Explorer (main knows the path; the renderer cannot pass one). */
  revealPackage(): Promise<void>

  /** Install Skyrim fonts for Figma (opt-in, per user): what the manifest lists. */
  getFontStatus(): Promise<FontToolStatus>
  /** Extracts the fonts from the user's own game and installs them per user. Only on an explicit, confirmed click; never rejects. */
  installFonts(): Promise<FontToolResult>
  /** Reverses exactly what the manifest lists; never rejects. */
  removeFonts(): Promise<FontToolResult>
  onFontProgress(cb: (p: FontToolProgress) => void): () => void
}
