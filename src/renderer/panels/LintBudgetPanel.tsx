import { CircleX, Info, TriangleAlert } from 'lucide-react'
import type { Severity } from '../../shared/lint'
import { inkwell } from '../hooks/api'
import { useState } from 'react'
import { useActiveSwf, useDockRows, useProject } from '../hooks/useProject'
import { BUDGET_LIMITS, budgetState, countBudget } from '../model/budget'
import { countSeverities, filterDockRows, groupDockRows } from '../model/lintRows'
import { openGraphNode } from '../state/graphReveal'
import { useLintStore } from '../state/lintStore'
import { useProjectStore } from '../state/projectStore'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

const ICON = { error: CircleX, warning: TriangleAlert, info: Info }
const TONE = { error: 'tone-error', warning: 'tone-warn', info: 'tone-info' }
/** An issue that names more layers than this shows the first ones and a "+N more" chip. */
const LAYERS_SHOWN = 5

/** Tab label with the live counts (UX 4.6: `Lint & Budget (1 Err, 2 Warn)`). */
export function useLintTab(): { label: string } {
  const c = countSeverities(useDockRows())
  return { label: strings.dock.lintTab(c.errors, c.warnings) }
}

function Meter({ label, value, limit }: { label: string; value: number; limit: number }) {
  const state = budgetState(value, limit)
  return (
    <span className="lint-budget-item">
      {label}
      <span className={`meter meter-${state}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(value, limit)} aria-valuetext={`${value} of ${limit}`}>
        <span className="meter-fill" style={{ width: `${Math.min(100, (value / limit) * 100)}%` }} />
      </span>
      <span className="mono dim">{value} / {limit}</span>
    </span>
  )
}

/**
 * Zone 6A, tab 1 (UX 4.6): the single lint source (compiler rows + unreachable layers + a failed build) as one row per issue (rows with the
 * same code and message name their layers as chips), severity filter, current-SWF-only, Strict Mode (stored in project.json through main),
 * and the HUD budget in one line with placeholder limits. A row or chip click selects the component through the selection model (source
 * `lint`); Figma is not told (only the `Select in Figma` buttons do).
 */
export function LintBudgetPanel() {
  const all = useDockRows()
  const project = useProject()
  const swf = useActiveSwf()
  const { severity, currentSwfOnly, setSeverity, setCurrentSwfOnly } = useLintStore()
  const issue = useSelectionStore((s) => s.issue)
  const fromLint = useSelectionStore((s) => s.selectFromLint)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const rows = filterDockRows(all, { severity, ...(currentSwfOnly && swf ? { currentSwf: swf.name } : {}) })
  const groups = groupDockRows(rows)
  const budget = swf ? countBudget(swf.ir) : undefined
  const counts = { ...countSeverities(all), infos: all.filter((r) => r.severity === 'info').length }

  const open = (r: (typeof rows)[number]): void => {
    // a graph issue opens that graph and selects the node (its layer, when it has one, is selected too)
    if (r.graphId && r.graphNodeId && openGraphNode({ swfName: r.swfName, graph: r.graphId, node: r.graphNodeId, lintKey: r.key, ...(r.nodeId ? { component: r.nodeId } : {}) })) return
    if (!r.nodeId) return
    const target = project?.swfs.find((s) => s.name === r.swfName)
    if (target) useProjectStore.getState().setActiveSwf(target.id)
    fromLint({ key: r.key, nodeId: r.nodeId })
  }
  const canOpen = (r: (typeof rows)[number]): boolean => Boolean(r.nodeId || r.graphNodeId)
  const toggle = (key: string): void => setExpanded((cur) => { const n = new Set(cur); if (!n.delete(key)) n.add(key); return n })
  // one button per severity: it filters to that severity, a second click shows all again
  const filterBtn = (sev: Severity, label: string, n: number, chip: string) => {
    const Icon = ICON[sev]
    return (
      <Btn pressed={severity === sev} onClick={() => setSeverity(severity === sev ? 'all' : sev)} testId={`lint-filter-${sev}`}>
        <Icon size={13} aria-hidden="true" className={TONE[sev]} /> {label} <span className={`chip${n ? ` ${chip}` : ''}`}>{n}</span>
      </Btn>
    )
  }

  return (
    <Panel title={strings.dock.lintTitle}>
      <div className="dock-lint">
        <div className="toolbar">
          {filterBtn('error', strings.dock.errors, counts.errors, 'chip-error')}
          {filterBtn('warning', strings.dock.warnings, counts.warnings, 'chip-warn')}
          {filterBtn('info', strings.dock.infos, counts.infos, 'chip-info')}
          <span className="push-right row-actions">
            <Btn pressed={currentSwfOnly} onClick={() => setCurrentSwfOnly(!currentSwfOnly)} testId="lint-current-swf">{strings.dock.currentSwfOnly}</Btn>
            <span title={strings.dock.strictHelp}>
              <Btn pressed={project?.strictMode ?? false} reason={project ? undefined : strings.dock.noProject} onClick={() => void inkwell?.setStrictMode(!(project?.strictMode ?? false))} testId="strict-mode">{strings.dock.strict}</Btn>
            </span>
          </span>
        </div>
        <div className="lint-list">
        {groups.length ? (
          <table className="lint-table" data-testid="lint-table">
            <colgroup><col className="lint-col-icon" /><col className="lint-col-issue" /><col /><col className="lint-col-code" /></colgroup>
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">{strings.dock.colSeverity}</span></th>
                <th scope="col">{strings.dock.colIssue}</th>
                <th scope="col">{strings.dock.colLayers}</th>
                <th scope="col">{strings.dock.colCode}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const Icon = ICON[g.severity]
                const more = expanded.has(g.key)
                const shown = more ? g.rows : g.rows.slice(0, LAYERS_SHOWN)
                return (
                  <tr key={g.key} className={`${g.rows.some(canOpen) ? 'is-link' : ''}${g.severity === 'info' ? ' lint-info' : ''}${g.rows.some((r) => r.key === issue) ? ' is-highlighted' : ''}`} onClick={() => { const r = g.rows.find(canOpen); if (r) open(r) }}>
                    <td className={TONE[g.severity]}><span role="img" aria-label={strings.dock.severity[g.severity]}><Icon size={13} aria-hidden="true" /></span></td>
                    <td>{g.message}</td>
                    <td>
                      <div className="lint-layers">
                        {shown.map((r) => canOpen(r)
                          ? <button key={r.key} type="button" className="chip lint-layer" onClick={(e) => { e.stopPropagation(); open(r) }} title={`${strings.dock.select(r.layerName || r.swfName)}${r.nodeId ? ` (${r.nodeId})` : ''}`}>{r.layerName || r.swfName || strings.dock.project}</button>
                          : <span key={r.key} className="chip">{r.swfName || strings.dock.project}</span>)}
                        {g.rows.length > LAYERS_SHOWN && (
                          <button type="button" className="chip lint-layer" aria-expanded={more} onClick={(e) => { e.stopPropagation(); toggle(g.key) }}>{more ? strings.dock.less : strings.dock.more(g.rows.length - LAYERS_SHOWN)}</button>
                        )}
                      </div>
                    </td>
                    <td className="mono dim">{g.code}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="empty">{all.length ? strings.dock.noMatch : strings.dock.noIssues}</p>
        )}
        </div>
        <div className="lint-budget" aria-label={strings.dock.budget} title={strings.dock.budgetTip}>
          <h3>{strings.dock.budget}</h3>
          {budget ? (
            <>
              <Meter label={strings.dock.shapes} value={budget.shapes} limit={BUDGET_LIMITS.shapes} />
              <Meter label={strings.dock.masks} value={budget.masks} limit={BUDGET_LIMITS.masks} />
              <Meter label={strings.dock.alpha} value={budget.alphaLayers} limit={BUDGET_LIMITS.alphaLayers} />
            </>
          ) : <span className="dim">{strings.dock.budgetNone}</span>}
        </div>
      </div>
    </Panel>
  )
}
