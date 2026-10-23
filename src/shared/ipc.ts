import type { PreviewBuild, PreviewFontBlob, PreviewRendered } from './preview'
import type { SyncUiState } from './syncState'

/** Channel names, used by main and preload only. */
export const IPC = {
  syncGet: 'sync:get',
  syncUpdate: 'sync:update',
  previewGet: 'preview:get',
  previewBuild: 'preview:build',
  previewRendered: 'preview:rendered',
  previewFonts: 'preview:fonts'
} as const

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
}
