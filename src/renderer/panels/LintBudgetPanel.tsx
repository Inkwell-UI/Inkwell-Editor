import { CircleX, Info, TriangleAlert } from 'lucide-react'
import type { Severity } from '../../shared/lint'
import { inkwell } from '../hooks/api'
import { useActiveSwf, useDockRows, useProject } from '../hooks/useProject'
import { BUDGET_LIMITS, budgetState, countBudget } from '../model/budget'
import { countSeverities, filterDockRows } from '../model/lintRows'
import { openGraphNode } from '../state/graphReveal'
import { useLintStore } from '../state/lintStore'
import { useProjectStore } from '../state/projectStore'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../strings'
import { Panel } from './Panel'

const ICON = { error: CircleX, warning: TriangleAlert, info: Info }
const TONE = { error: 'tone-error', warning: 'tone-warn', info: 'tone-info' }

/** Tab label with the live counts (UX 4.6: `Lint & Budget (1 Err, 2 Warn)`). */
export function useLintTab(): { label: string } {
  const c = countSeverities(useDockRows())
  return { label: strings.dock.lintTab(c.errors, c.warnings) }
}

function Meter({ label, value, limit, placeholder }: { label: string; value: number; limit: number; placeholder?: boolean }) {
  const state = budgetState(value, limit)
  return (
    <div className="meter-row">
      <span className="meter-label">{label}</span>
      <div className={`meter meter-${state}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(value, limit)} aria-valuetext={`${value} of ${limit}${placeholder ? '*' : ''}`}>
        <div className="meter-fill" style={{ width: `${Math.min(100, (value / limit) * 100)}%` }} />
      </div>
      <span className="mono">{value}/{limit}{placeholder ? '*' : ''}</span>
    </div>
  )
}

/**
 * Zone 6A, tab 1 (UX 4.6): the single lint source (compiler rows + unreachable layers + a failed build), severity filter, current-SWF-only,
 * Strict Mode (stored in project.json through main), and the HUD budget meter with placeholder limits. A row click selects the component
 * through the selection model (source `lint`); Figma is not told (no protocol message yet).
 */
export function LintBudgetPanel() {
  const all = useDockRows()
  const project = useProject()
  const swf = useActiveSwf()
  const { severity, currentSwfOnly, setSeverity, setCurrentSwfOnly } = useLintStore()
  const issue = useSelectionStore((s) => s.issue)
  const fromLint = useSelectionStore((s) => s.selectFromLint)
  const rows = filterDockRows(all, { severity, ...(currentSwfOnly && swf ? { currentSwf: swf.name } : {}) })
  const budget = swf ? countBudget(swf.ir) : undefined

  const open = (r: (typeof rows)[number]): void => {
    // a graph issue opens that graph and selects the node (its layer, when it has one, is selected too)
    if (r.graphId && r.graphNodeId && openGraphNode({ swfName: r.swfName, graph: r.graphId, node: r.graphNodeId, lintKey: r.key, ...(r.nodeId ? { component: r.nodeId } : {}) })) return
    if (!r.nodeId) return
    const target = project?.swfs.find((s) => s.name === r.swfName)
    if (target) useProjectStore.getState().setActiveSwf(target.id)
    fromLint({ key: r.key, nodeId: r.nodeId })
  }

  return (
    <Panel title={strings.dock.lintTitle}>
      <div className="dock-lint">
        <div className="toolbar">
          <label>
            {strings.dock.filter}{' '}
            <select value={severity} onChange={(e) => setSeverity(e.target.value as 'all' | Severity)} data-testid="lint-severity">
              <option value="all">{strings.dock.allSeverities}</option>
              <option value="error">{strings.dock.errors}</option>
              <option value="warning">{strings.dock.warnings}</option>
              <option value="info">{strings.dock.infos}</option>
            </select>
          </label>
          <label><input type="checkbox" checked={currentSwfOnly} onChange={(e) => setCurrentSwfOnly(e.target.checked)} /> {strings.dock.currentSwfOnly}</label>
          <label className="push-right" title={strings.dock.strictHelp}>
            <input type="checkbox" checked={project?.strictMode ?? false} disabled={!project} onChange={(e) => void inkwell?.setStrictMode(e.target.checked)} data-testid="strict-mode" /> {strings.dock.strict}
          </label>
        </div>
        {rows.length ? (
          <table className="lint-table" data-testid="lint-table">
            <thead>
              <tr>{strings.dock.cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const Icon = ICON[r.severity]
                return (
                  <tr key={r.key} className={`${r.nodeId || r.graphNodeId ? 'is-link' : ''}${issue === r.key ? ' is-highlighted' : ''}`} onClick={() => open(r)}>
                    <td className={TONE[r.severity]}><Icon size={13} aria-hidden="true" /> {strings.dock.severity[r.severity]}</td>
                    <td className="mono">{r.code}</td>
                    <td>
                      {r.nodeId ? <button type="button" className="row-link" onClick={(e) => { e.stopPropagation(); open(r) }} title={strings.dock.select(r.layerName)}>{r.layerName} <span className="dim mono">({r.nodeId})</span></button> : <span className="dim">{r.swfName || strings.dock.project}</span>}
                    </td>
                    <td>{r.message}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="empty">{all.length ? strings.dock.noMatch : strings.dock.noIssues}</p>
        )}
        <div className="budget" aria-label={strings.dock.budget}>
          <h3>{strings.dock.budget}</h3>
          {budget ? (
            <>
              <Meter label={strings.dock.shapes} value={budget.shapes} limit={BUDGET_LIMITS.shapes} placeholder />
              <Meter label={strings.dock.masks} value={budget.masks} limit={BUDGET_LIMITS.masks} placeholder />
              <Meter label={strings.dock.alpha} value={budget.alphaLayers} limit={BUDGET_LIMITS.alphaLayers} placeholder />
            </>
          ) : <p className="empty">{strings.dock.budgetNone}</p>}
          <p className="dim">{strings.dock.placeholderNote}</p>
        </div>
      </div>
    </Panel>
  )
}
