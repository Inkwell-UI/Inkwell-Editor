import type { DevEvent, DevReloadResult, DevState } from './devLink'
import type { DeployResult, DeployScope, DeployTargetId, DeployTargetInfo, PrepareResult } from './deploy'
import type { BenchmarkResult, BuildCacheResult, CheckId, CheckResult, PathSettingKey, ResolvedSettings, SetSettingResult, SettingKey } from './doctor'
import type { FontToolProgress, FontToolResult, FontToolStatus } from './fonts'
import type { Graph, MenuSettings } from '@inkwell-ui/spec'
import type { GraphAs2, GraphResult, GraphSummary, PackSet } from './graphs'
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
  swfDiscard: 'swf:discard',
  graphsAs2: 'graphs:as2',
  packsGet: 'packs:get',
  strictSet: 'project:strict',
  buildAll: 'build:all',
  previewDetach: 'preview:detach',
  previewDetached: 'preview:detached',
  uiEvent: 'ui:event',
  figmaSelection: 'figma:selection',
  menuSettings: 'menu:settings',
  menuSave: 'menu:save',
  doctorRun: 'doctor:run',
  doctorBenchmark: 'doctor:benchmark',
  doctorBuildCache: 'doctor:buildCache',
  doctorFirstLaunch: 'doctor:firstLaunch',
  figmaApproval: 'figma:approval',
  figmaForget: 'figma:forget',
  figmaSelect: 'figma:select',
  figmaPluginCount: 'figma:pluginCount',
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
  fontsProgress: 'fonts:progress',
  devGet: 'dev:get',
  devState: 'dev:state',
  devEvents: 'dev:events',
  devConnect: 'dev:connect',
  devDisconnect: 'dev:disconnect',
  devToken: 'dev:token',
  devPort: 'dev:port',
  devDeploy: 'dev:deploy',
  devReload: 'dev:reload'
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
  /** Writes `swfs/<swfName>/menu.json` (the Spec's MenuSettings; validated, unknown keys kept as sent). The project state follows. */
  saveMenuSettings(swfName: string, settings: MenuSettings): Promise<SaveOverlayResult>
  /** Graphs of one SWF (`swfs/<swfName>/graphs/*.json`, docs/graphs.md): summaries, one graph, write (validated; unknown keys kept), create (an id is made from the name; one menu graph per SWF), delete. Never reject. */
  listGraphs(swfName: string): Promise<GraphResult<{ graphs: GraphSummary[] }>>
  loadGraph(swfName: string, id: string): Promise<GraphResult<{ graph: Graph }>>
  saveGraph(swfName: string, graph: Graph): Promise<GraphResult>
  createGraph(swfName: string, name: string, scope: Graph['scope']): Promise<GraphResult<{ graph: Graph }>>
  deleteGraph(swfName: string, id: string): Promise<GraphResult>
  /** Runs codegen on the open (unsaved) `graph` next to the SWF's other saved graphs and returns its AS2 class with the source map (the AS2 split view). Not a build: no FFDec. */
  /** Discards an ORPHANED SWF by id: its folder moves to `<project>/.trash/` (never deleted). Refused for a SWF that still has a Figma frame. */
  discardSwf(swfId: string): Promise<{ ok: true; trash: string } | { ok: false; error: string }>
  graphAs2(swfName: string, graph: Graph): Promise<GraphResult<{ as2: GraphAs2 }>>
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

  /** Answers the pending Figma plugin prompt (`SyncUiState.approval.id`). */
  answerFigmaApproval(id: number, allow: boolean): Promise<void>
  /** How many Figma plugins the user approved (Settings). */
  figmaPluginCount(): Promise<number>
  /** Select (`focus` false) or select and zoom to (`focus` true) a layer in Figma, through the approved connected plugin (protocol 5). */
  selectInFigma(nodeId: string, focus: boolean): Promise<{ ok: true } | { ok: false; error: string }>
  /** Settings > Forget all Figma plugins: removes every approved credential and disconnects the plugins. Returns the reason on failure. */
  forgetFigmaPlugins(): Promise<{ ok: true } | { ok: false; error: string }>

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

  /** The game dev connection (docs/dev-mode.md): state (never the token, only `tokenMasked`), the stream of trace/watch/pin events in batches, and the controls. */
  getDevState(): Promise<DevState>
  onDevState(cb: (s: DevState) => void): () => void
  onDevEvents(cb: (e: DevEvent[]) => void): () => void
  /** Connect (also retries after a refusal) / Disconnect (stops the automatic retries for this session). */
  devConnect(): Promise<void>
  devDisconnect(): Promise<void>
  /** Paste the token of the game's Inkwell.ini (`null` forgets the pasted one). The reason when it is not 64 hex digits. */
  devSetToken(token: string | null): Promise<{ ok: true } | { ok: false; error: string }>
  devSetPort(port: number): Promise<{ ok: true } | { ok: false; error: string }>
  /** The project's Dev deploy toggle (off by default). Turning it on makes the token (once) and builds the dev SWFs. */
  devSetDeploy(on: boolean): Promise<void>
  /** Trigger Hot Reload: `menu` absent = every menu. Never rejects. */
  devReload(menu?: string): Promise<DevReloadResult>
}
