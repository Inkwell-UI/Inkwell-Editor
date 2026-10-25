import { promoteStrict, SEVERITY_RANK, type Severity } from '../../shared/lint'
import type { LayerRef, LintRow, SyncUiState } from '../../shared/syncState'
import { strings } from '../strings'

/** One row of the Lint & Budget dock. The single validation source is the main process; this only merges its feeds and applies display rules. */
export interface DockRow {
  /** Stable within one list: swf | node | code | n-th of that triple. */
  key: string
  severity: Severity
  code: string
  message: string
  swfName: string
  /** Figma node id; absent for project-level failures (a build that threw). */
  nodeId?: string
  layerName: string
  /** Set for graph issues: the graph and graph node to open. */
  graphId?: string
  graphNodeId?: string
}

export const BUILD_FAILED_CODE = 'build-failed'

/**
 * Merges the compiler lint rows, the `unreachable-node` warnings (inside SWFs and loose layers) and, when the last build failed with a
 * message no lint row carries (FFDec missing, the build threw), a synthetic `build-failed` error that sorts first. Strict Mode promotes warnings.
 */
export function buildDockRows(input: {
  lint: readonly LintRow[]
  looseLayers?: readonly LayerRef[]
  unreachable?: readonly (LayerRef & { swfName: string })[]
  build?: SyncUiState['build']
  buildError?: string
  strict: boolean
}): DockRow[] {
  const raw: Omit<DockRow, 'key'>[] = [
    ...input.lint.map((l) => ({ severity: l.severity, code: l.code, message: l.message, swfName: l.swfName, ...(l.nodeId ? { nodeId: l.nodeId } : {}), layerName: l.layerName, ...(l.graphId ? { graphId: l.graphId } : {}), ...(l.graphNodeId ? { graphNodeId: l.graphNodeId } : {}) })),
    ...(input.unreachable ?? []).map((u) => ({ severity: 'warning' as const, code: 'unreachable-node', message: unreachableMessage(u.name), swfName: u.swfName, nodeId: u.id, layerName: u.name })),
    ...(input.looseLayers ?? []).map((u) => ({ severity: 'warning' as const, code: 'unreachable-node', message: unreachableMessage(u.name), swfName: '', nodeId: u.id, layerName: u.name }))
  ]
  const promoted = promoteStrict(raw, input.strict)
  const failed: Omit<DockRow, 'key'>[] =
    input.build === 'error' && input.buildError && !raw.some((r) => r.severity === 'error' && r.message === input.buildError)
      ? [{ severity: 'error', code: BUILD_FAILED_CODE, message: input.buildError, swfName: '', layerName: '' }]
      : []
  const seen = new Map<string, number>()
  return [...failed, ...promoted.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])].map((r) => {
    const base = `${r.swfName}|${r.nodeId ?? ''}|${r.code}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { ...r, key: `${base}|${n}` }
  })
}

const unreachableMessage = strings.dock.unreachable

export interface DockFilter {
  severity: 'all' | Severity
  /** Only rows of this SWF (project-level rows with no SWF stay visible: they affect every SWF). */
  currentSwf?: string
}
export function filterDockRows(rows: readonly DockRow[], f: DockFilter): DockRow[] {
  return rows.filter((r) => (f.severity === 'all' || r.severity === f.severity) && (f.currentSwf === undefined || r.swfName === '' || r.swfName === f.currentSwf))
}

export const countSeverities = (rows: readonly DockRow[]): { errors: number; warnings: number } => ({
  errors: rows.filter((r) => r.severity === 'error').length,
  warnings: rows.filter((r) => r.severity === 'warning').length
})

/** The row the "Build failed" banner jumps to: the first error (the synthetic build failure sorts first). */
export const firstError = (rows: readonly DockRow[]): DockRow | undefined => rows.find((r) => r.severity === 'error')
