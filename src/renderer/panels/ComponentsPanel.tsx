import { Component, Crosshair } from 'lucide-react'
import { inkwell } from '../hooks/api'
import { useProject } from '../hooks/useProject'
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
  const sync = useSyncState()
  const rows = useMemo(() => componentRows((project?.swfs ?? []).map((s) => s.ir), sync?.pageComponents), [project, sync?.pageComponents])
  const reason = figmaSelectReason(sync, { notConnected: strings.selectInFigmaReason, pending: strings.selectInFigmaPending })
  const select = (id: string): void => {
    void inkwell?.selectInFigma(id, true).then((r) => {
      if (!r.ok) useToastStore.getState().push({ tone: 'error', title: strings.selectInFigmaFailed(r.error) })
    })
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
                  <Btn icon={Crosshair} variant="quiet" label={strings.selectInFigma} reason={reason} onClick={() => select(r.id)} testId="component-select" />
                </div>
                <div className="graph-row-events">{strings.comp.instances(r.instances)}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Panel>
  )
}
