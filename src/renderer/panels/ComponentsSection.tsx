import { Component, Crosshair } from 'lucide-react'
import { inkwell } from '../hooks/api'
import { useActiveSwf } from '../hooks/useProject'
import { useOpenComponent } from '../hooks/useOpenComponent'
import { COMPONENT_DRAG } from '../state/componentGraphs'
import { useSyncState } from '../hooks/useSyncState'
import { figmaSelectReason } from '../model/connection'
import { useToastStore } from '../state/toastStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'

/** The Logic panel's Components section: every component the project has (designed in Figma, kept inside a frame or away from the design); a click opens its graph. Hidden while there are none. */
export function ComponentsSection() {
  const swf = useActiveSwf()
  const sync = useSyncState()
  const { rows, graphs, activeId, openGraph } = useOpenComponent()
  const reason = figmaSelectReason(sync, { notConnected: strings.selectInFigmaReason, pending: strings.selectInFigmaPending })
  const select = (id: string): void => {
    void inkwell?.selectInFigma(id, true).then((r) => {
      if (!r.ok) useToastStore.getState().push({ tone: 'error', title: strings.selectInFigmaFailed(r.error) })
    })
  }
  if (rows.length === 0) return null
  return (
        <section aria-labelledby="comp-list" data-testid="components-section">
          <header className="section-title"><h3 id="comp-list">{strings.comp.heading}</h3></header>
          <ul className="graph-list" role="list">
            {rows.map((r) => {
              const g = graphs[r.id]
              const active = !!g && g.id === activeId
              return (
                <li key={r.id} className={`graph-row graph-row-grid${active ? ' is-selected' : ''}`} data-testid="component-row" draggable onDragStart={(e) => { e.dataTransfer.setData(COMPONENT_DRAG, r.id); e.dataTransfer.effectAllowed = 'link' }}>
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
  )
}
