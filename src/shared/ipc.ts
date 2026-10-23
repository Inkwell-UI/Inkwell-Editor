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
  strictSet: 'project:strict',
  buildAll: 'build:all',
  previewDetach: 'preview:detach',
  previewDetached: 'preview:detached',
  uiEvent: 'ui:event',
  figmaSelection: 'figma:selection'
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
}
