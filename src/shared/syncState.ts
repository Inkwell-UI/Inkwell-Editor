import type { DeployState } from './deploy'
import type { BuildTiming } from './timing'

/** What the main process tells the renderer about the Figma sync server. */
export interface SyncUiState {
  server: 'starting' | 'listening' | 'error'
  error?: string
  port?: number
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
  /** Issues of the visual-scripting graphs (the one graph validation, run in main); the Lint dock shows them with `lint`. */
  graphLint?: LintRow[]
  /** FFDec / Java / wrapper availability (the status bar and the Setup Doctor stub). */
  ffdec?: FfdecState
  /** Progress or result of the last Deploy (status bar and toast). */
  deploy?: DeployState
  /** Increases with every Deploy state change. */
  deploySeq?: number
  /** Increases with every finished build; `timing` belongs to `timingSwf`. */
  buildSeq?: number
  timingSwf?: string
  /** Loose top-level Figma layers (belong to no SWF), from the plugin's `swfs` message. */
  looseLayers?: LayerRef[]
  /** Nodes inside a SWF that no root reaches (`unreachable-node` in the SWF's build status). */
  unreachableNodes?: (LayerRef & { swfName: string })[]
  /** A Figma plugin with an unknown secret is waiting for Allow / Deny (protocol 4). The window shows the prompt; the Figma dot reads "Waiting for approval". */
  approval?: { id: number; pluginVersion: string; fileName: string; origin: string }
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
  via: 'text style' | 'family/style' | 'fallback' | 'unmapped' | 'embedded'
  /** via 'embedded': the family of the custom font. */
  embedded?: string
}
export interface LintRow {
  swfName: string
  nodeId: string
  layerName: string
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  /** Graph issues (docs/graphs.md): the graph and the graph node the issue is pinned to. `nodeId` is then the targeted Figma layer, or '' when there is none. */
  graphId?: string
  graphNodeId?: string
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
