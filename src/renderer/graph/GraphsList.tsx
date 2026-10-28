import { useState } from 'react'
import { Check, Pencil, Trash2, Workflow, X } from 'lucide-react'
import { useStore } from 'zustand'
import { useSwfGraphs } from '../hooks/useGraphs'
import { usePacks } from '../hooks/usePacks'
import { useActiveSwf } from '../hooks/useProject'
import { eventNodes } from '../model/graphModel'
import { setActiveGraph } from '../state/graphDocs'
import { findGraphStore } from '../state/graphStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { useGraphActions } from './useGraphActions'

/** The Navigator's GRAPHS section (UX 4.2): one row per graph of the active SWF (name, scope, its events), `[+ Graph]`, rename and delete. */
export function GraphsList() {
  const swf = useActiveSwf()
  const { ids, activeId, loaded } = useSwfGraphs()
  const actions = useGraphActions()
  return (
    <section aria-labelledby="nav-graphs" data-testid="graphs-section">
      <header className="section-title">
        <h3 id="nav-graphs">{strings.nav.graphs}</h3>
        <Btn label={strings.nav.addGraph} testId="graph-add-nav" onClick={() => void actions.add()} reason={actions.canAdd}>{strings.nav.addGraphShort}</Btn>
        <Btn label={strings.nav.addFunction} testId="function-add-nav" onClick={() => void actions.addFn()} reason={actions.canAdd}>{strings.nav.addFunctionShort}</Btn>
      </header>
      {actions.error && <p className="tone-error">{actions.error}</p>}
      {swf && loaded && ids.length === 0 && <p className="empty">{strings.nav.graphsEmpty}</p>}
      <ul className="graph-list" role="list">
        {swf && ids.map((id) => <GraphRow key={id} swfId={swf.id} id={id} active={id === activeId} actions={actions} />)}
      </ul>
    </section>
  )
}

function GraphRow({ swfId, id, active, actions }: { swfId: string; id: string; active: boolean; actions: ReturnType<typeof useGraphActions> }) {
  const store = findGraphStore(swfId, id)
  if (!store) return null
  return <Row swfId={swfId} id={id} active={active} actions={actions} store={store} />
}

function Row({ swfId, id, active, actions, store }: { swfId: string; id: string; active: boolean; actions: ReturnType<typeof useGraphActions>; store: NonNullable<ReturnType<typeof findGraphStore>> }) {
  const name = useStore(store, (s) => s.name)
  const scope = useStore(store, (s) => s.meta.scope)
  const nodes = useStore(store, (s) => s.nodes)
  const defs = usePacks()
  const [editing, setEditing] = useState<string>()
  const [confirm, setConfirm] = useState(false)
  const events = eventNodes(defs, nodes)
  const commit = (): void => {
    if (editing !== undefined) actions.rename(id, editing)
    setEditing(undefined)
  }
  return (
    <li className={`graph-row${active ? ' is-selected' : ''}`} data-testid={`graph-row-${id}`}>
      <div className="graph-row-main">
        {editing !== undefined ? (
          <>
            <input autoFocus className="gn-input" aria-label={strings.nav.renameGraph} value={editing} onChange={(e) => setEditing(e.target.value)} onKeyDown={(e) => e.key === 'Enter' ? commit() : e.key === 'Escape' && setEditing(undefined)} data-testid="graph-rename-input" />
            <Btn icon={Check} label={strings.nav.renameOk} onClick={commit} />
          </>
        ) : (
          <>
            <button type="button" className="layer-main" aria-pressed={active} onClick={() => setActiveGraph(swfId, id)} data-testid="graph-open">
              <Workflow size={14} aria-hidden="true" className="type-icon" />
              <span className="layer-name">{name}</span>
              <span className="layer-type">{scope === 'menu' ? strings.nav.menuGraph : scope === 'function' ? strings.nav.functionGraph : strings.nav.componentGraph}</span>
            </button>
            <Btn icon={Pencil} label={strings.nav.renameGraph} onClick={() => setEditing(name)} testId="graph-rename" />
            {confirm ? (
              <>
                <Btn variant="danger" onClick={() => (setConfirm(false), void actions.remove(id))} testId="graph-delete-confirm">{strings.nav.deleteConfirm}</Btn>
                <Btn icon={X} label={strings.nav.deleteCancel} onClick={() => setConfirm(false)} />
              </>
            ) : (
              <Btn icon={Trash2} label={strings.nav.deleteGraph(name)} onClick={() => setConfirm(true)} testId="graph-delete" />
            )}
          </>
        )}
      </div>
      {events.length > 0 && <div className="graph-row-events dim">{events.map((e) => (e.detail ? `${e.title}: ${e.detail}` : e.title)).join(' · ')}</div>}
    </li>
  )
}
