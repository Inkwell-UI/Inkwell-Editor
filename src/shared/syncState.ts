import type { BuildTiming } from './timing'

/** What the main process tells the renderer about the Figma sync server. */
export interface SyncUiState {
  server: 'starting' | 'listening' | 'error'
  error?: string
  port?: number
  token?: string
  connections: number
  build: 'idle' | 'compiling' | 'synced' | 'error'
  /** Message of the first issue when build is 'error'. */
  buildError?: string
  timing?: BuildTiming
  /** Lint issues over all swfs plus loose layers. */
  lintCount: number
  swfCount: number
  orphanedCount: number
}
