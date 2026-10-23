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
  /** Renderer-measured build-ready -> Ruffle first frame (ms) for the latest build; absent until it renders (or when no preview panel is open). */
  previewMs?: number
  /** Lint issues over all swfs plus loose layers. */
  lintCount: number
  swfCount: number
  orphanedCount: number
  /** Latest build of every swf, flattened (added later; absent in older states). */
  fonts?: FontRow[]
  lint?: LintRow[]
  /** FFDec / Java / wrapper availability (the status bar and the Setup Doctor stub). */
  ffdec?: FfdecState
  /** Increases with every finished build; `timing` belongs to `timingSwf`. */
  buildSeq?: number
  timingSwf?: string
  /** Loose top-level Figma layers (belong to no SWF), from the plugin's `swfs` message. */
  looseLayers?: LayerRef[]
  /** Nodes inside a SWF that no root reaches (`unreachable-node` in the SWF's build status). */
  unreachableNodes?: (LayerRef & { swfName: string })[]
  /** Why the last plugin connection attempt failed (cleared by the next successful hello). */
  connectionIssue?: { kind: 'version' | 'auth'; message: string }
}

export interface LayerRef {
  id: string
  name: string
}

export interface FfdecState {
  status: 'warm' | 'cold' | 'notFound'
  /** What is missing when `notFound`. */
  reason?: 'ffdec' | 'wrapper' | 'java'
}

export interface FontRow {
  swfName: string
  nodeId: string
  layerName: string
  figmaFont: string
  styleName?: string
  alias?: string
  via: 'text style' | 'family/style' | 'fallback' | 'unmapped'
}
export interface LintRow {
  swfName: string
  nodeId: string
  layerName: string
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
}
/** What one build of one swf reports; the main process keeps the latest per swf id so frames never overwrite each other. */
export interface SwfReport {
  swfId: string
  name: string
  fonts: FontRow[]
  lint: LintRow[]
}

const RANK = { error: 0, warning: 1, info: 2 }
/** Flattens the per-swf reports for the window: fonts by swf then insertion order, lint errors first. */
export function flattenReports(reports: Iterable<SwfReport>): { fonts: FontRow[]; lint: LintRow[] } {
  const all = [...reports]
  return {
    fonts: all.flatMap((r) => r.fonts),
    lint: all.flatMap((r) => r.lint).sort((a, b) => RANK[a.severity] - RANK[b.severity])
  }
}
