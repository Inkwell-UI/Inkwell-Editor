import { useEffect } from 'react'
import { Component, Crosshair } from 'lucide-react'
import { inkwell } from '../hooks/api'
import { useActiveSwf, useProject } from '../hooks/useProject'
import { createComponentGraph, loadComponentGraphs, useComponentGraphs } from '../state/componentGraphs'
import { openComponentGraph, useGraphDocs } from '../state/graphDocs'
import { useSyncState } from '../hooks/useSyncState'
import { figmaSelectReason } from '../model/connection'
import { componentRows } from '../model/componentList'
import { useMemo } from 'react'
import { useSelectionStore } from '../state/selectionStore'
import { useToastStore } from '../state/toastStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/** Behaviour, left tab 3: every component the project has (designed in Figma, kept inside a frame or away from the design), with where it is and how many instances use it. */
export function ComponentsPanel() {
  const project = useProject()
  const swf = useActiveSwf()
  const sync = useSyncState()
  const graphs = useComponentGraphs((s) => s.graphs)
  const activeId = useGraphDocs((s) => (swf ? s.active[swf.id] : undefined))
  useEffect(() => void (inkwell && loadComponentGraphs(inkwell)), [project?.dir])
  const rows = useMemo(() => componentRows((project?.swfs ?? []).map((s) => s.ir), sync?.pageComponents), [project, sync?.pageComponents])
  const reason = figmaSelectReason(sync, { notConnected: strings.selectInFigmaReason, pending: strings.selectInFigmaPending })
  const select = (id: string): void => {
    void inkwell?.selectInFigma(id, true).then((r) => {
      if (!r.ok) useToastStore.getState().push({ tone: 'error', title: strings.selectInFigmaFailed(r.error) })
    })
  }
  // the graph of a component: made on first use, then opened in the Graph panel (which borrows the active SWF)
  const openGraph = async (id: string, name: string): Promise<void> => {
    if (!inkwell || !swf) return
    useSelectionStore.getState().clear() // nothing selected: the Inspector shows this graph's props
    const have = graphs[id] ?? (await createComponentGraph(id, name, inkwell).then((r) => (r.ok ? r.graph : undefined)))
    if (!have) return void useToastStore.getState().push({ tone: 'error', title: strings.comp.graphFailed })
    openComponentGraph({ id: swf.id, name: swf.name }, have)
  }
  return (
    <Panel title={strings.comp.title}>
      <div className="nav">
        <section aria-labelledby="comp-list" data-testid="components-section">
          <header className="section-title"><h3 id="comp-list">{strings.comp.heading}</h3></header>
          {rows.length === 0 && <p className="empty">{strings.comp.empty}</p>}
          <ul className="graph-list" role="list">
            {rows.map((r) => {
              const g = graphs[r.id]
              const active = !!g && g.id === activeId
              return (
                <li key={r.id} className={`graph-row graph-row-grid${active ? ' is-selected' : ''}`} data-testid="component-row">
                  <div className="graph-row-main">
                    <button type="button" className="layer-main" aria-pressed={active} title={swf ? undefined : strings.comp.noSwf} disabled={!swf} onClick={() => void openGraph(r.id, r.name)} data-testid="component-graph">
                      <Component size={14} aria-hidden="true" className="type-icon" />
                      <span className="layer-name">{r.name}</span>
                    </button>
                    <span className="graph-row-actions">
                      <span className="row-reveal"><Btn icon={Crosshair} variant="quiet" label={strings.selectInFigma} reason={reason} onClick={() => select(r.id)} testId="component-select" /></span>
                    </span>
                  </div>
                  {!!g?.props?.length && <div className="graph-row-events dim">{strings.comp.props(g.props)}</div>}
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </Panel>
  )
}
