import { useEffect } from 'react'
import { Component, Crosshair, Plus, Workflow } from 'lucide-react'
import { inkwell } from '../hooks/api'
import { useActiveSwf, useProject } from '../hooks/useProject'
import { createComponentGraph, loadComponentGraphs, useComponentGraphs } from '../state/componentGraphs'
import { openComponentGraph } from '../state/graphDocs'
import { useSyncState } from '../hooks/useSyncState'
import { figmaSelectReason } from '../model/connection'
import { componentRows } from '../model/componentList'
import { useMemo } from 'react'
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
            {rows.map((r) => (
              <li key={r.id} className="graph-row" data-testid="component-row">
                <div className="graph-row-main">
                  <span className="layer-main"><Component size={14} aria-hidden="true" className="type-icon" /><span className="layer-name">{r.name}</span><span className="layer-type">{strings.comp.where(r.swfName)}</span></span>
                  <span className="row-reveal">
                    <Btn icon={graphs[r.id] ? Workflow : Plus} variant="quiet" label={graphs[r.id] ? strings.comp.openGraph : strings.comp.addGraph} reason={swf ? undefined : strings.comp.noSwf} onClick={() => void openGraph(r.id, r.name)} testId="component-graph" />
                    <Btn icon={Crosshair} variant="quiet" label={strings.selectInFigma} reason={reason} onClick={() => select(r.id)} testId="component-select" />
                  </span>
                </div>
                <div className="graph-row-events">{strings.comp.instances(r.instances)}{graphs[r.id] ? ` · ${strings.comp.props(graphs[r.id]!.props ?? [])}` : ''}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Panel>
  )
}
