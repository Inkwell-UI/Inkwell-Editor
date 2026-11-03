import { useState, type ReactNode } from 'react'
import { Check, Pencil, Plus, Trash2, Workflow, X } from 'lucide-react'
import { useStore } from 'zustand'
import { useSwfGraphs } from '../hooks/useGraphs'
import { usePacks } from '../hooks/usePacks'
import { useActiveSwf } from '../hooks/useProject'
import { eventNodes } from '../model/graphModel'
import { setActiveGraph } from '../state/graphDocs'
import { findGraphStore } from '../state/graphStore'
import { strings } from '../../shared/strings'
import { Btn } from '../ui/Btn'
import { InspFold } from '../ui/InspParts'
import { RowMenu } from '../ui/RowMenu'
import { moveToPack, useLocalPacks } from './packMove'
import { useGraphActions } from './useGraphActions'

/**
 * Rows of the Logic panel's Functions section (`FunctionRows`): a function's name and signature, rename and delete. A layer's graph has no list: the Navigator's layer opens it
 * (`state/graphDocs.ts` `openLayerGraph`).
 */
/** The drag payload of a function row: its id. The Library's local packs accept it and the graph canvas turns it into a Call Function node. */
export const FUNCTION_DRAG = 'application/x-inkwell-function'

/** The graphs' names for a closed card's summary; read once per render, which is enough because a closed card has no rename. */
export function graphNames(swfId: string | undefined, ids: string[]): string {
  return swfId ? ids.map((id) => findGraphStore(swfId, id)?.getState().name ?? '').filter(Boolean).join(', ') : ''
}

/** The SWF's own functions as rows (the Logic panel's Functions section); the empty state says how to make one. */
export function FunctionRows({ actions }: { actions: ReturnType<typeof useGraphActions> }) {
  const swf = useActiveSwf()
  const { ids, activeId, loaded } = useSwfGraphs()
  const mine = swf ? ids.filter((id) => findGraphStore(swf.id, id)?.getState().meta.scope === 'function') : []
  return (
    <>
      {actions.error && <p className="tone-error">{actions.error}</p>}
      {swf && loaded && mine.length === 0 && <p className="empty">{strings.lib.empty}</p>}
      <ul className="graph-list" role="list">
        {swf && mine.map((id) => <GraphRow key={id} swfId={swf.id} id={id} active={id === activeId} actions={actions} />)}
      </ul>
    </>
  )
}

/** The ids of the SWF's functions. */
export function useFunctionIds(): string[] {
  const swf = useActiveSwf()
  const { ids } = useSwfGraphs()
  return swf ? ids.filter((id) => findGraphStore(swf.id, id)?.getState().meta.scope === 'function') : []
}

/** How many functions the SWF has. */
export function useFunctionCount(): number {
  return useFunctionIds().length
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
  const sig = useStore(store, (s) => s.signature)
  const defs = usePacks()
  const swf = useActiveSwf()
  const locals = useLocalPacks()
  const events = scope === 'function' ? [] : eventNodes(defs, nodes)
  const moves = scope === 'function' && swf ? locals.map((p) => ({ label: strings.lib.moveTo(p.id), onClick: () => void moveToPack(swf, id, p.id) })) : []
  return <GraphRowView id={id} moves={moves} name={name} scope={String(scope)} sig={sig} events={events.map((e) => (e.detail ? `${e.title}: ${e.detail}` : e.title))} active={active} onOpen={() => setActiveGraph(swfId, id)} onRename={(n) => actions.rename(id, n)} onDelete={() => void actions.remove(id)} />
}

/**
 * One graph row (name, scope tag, rename, delete with confirm, signature line). The Library's pack rows use it for a pack's functions too, so a function looks the same in a pack as in the
 * project's list; `extra` adds buttons after the delete one.
 */
export function GraphRowView({ id, name, scope, sig, events = [], active, locked, onOpen, onRename, onDelete, extra, moves }: {
  id: string
  name: string
  scope: string
  sig: { inputs: { name: string; type: string }[]; outputs: { name: string; type: string }[]; exits: { name: string }[] } | undefined
  events?: string[]
  active: boolean
  /** Why this row cannot be edited (an imported pack's function): no open, rename or delete, only `extra`. */
  locked?: string
  onOpen(): void
  onRename(name: string): void
  onDelete(): void
  extra?: ReactNode
  /** More items for the "..." menu of a function row, between Rename and Delete (Move to <pack>). */
  moves?: { label: string; onClick(): void }[]
}) {
  const [editing, setEditing] = useState<string>()
  const [confirm, setConfirm] = useState(false)
  const fn = scope === 'function'
  const confirmButtons = (
    <>
      <Btn variant="quiet" className="row-confirm-delete" onClick={() => (setConfirm(false), onDelete())} testId="graph-delete-confirm">{strings.nav.deleteConfirm}</Btn>
      <Btn icon={X} variant="quiet" label={strings.nav.deleteCancel} onClick={() => setConfirm(false)} />
    </>
  )
  const sigText = sig ? strings.lib.signature(sig.inputs.map((p) => p.type), sig.outputs.map((p) => p.type), sig.exits.map((x) => x.name)) : undefined
  const commit = (): void => {
    if (editing !== undefined) onRename(editing)
    setEditing(undefined)
  }
  return (
    <li className={`graph-row graph-row-grid${active ? ' is-selected' : ''}`} data-testid={`graph-row-${id}`} draggable={scope === 'function'} onDragStart={(e) => e.dataTransfer.setData(FUNCTION_DRAG, id)}>
      <div className="graph-row-main">
        {editing !== undefined ? (
          <>
            <input autoFocus className="gn-input" aria-label={strings.nav.renameGraph} value={editing} onChange={(e) => setEditing(e.target.value)} onKeyDown={(e) => e.key === 'Enter' ? commit() : e.key === 'Escape' && setEditing(undefined)} data-testid="graph-rename-input" />
            <span className="graph-row-actions"><Btn icon={Check} label={strings.nav.renameOk} onClick={commit} /></span>
          </>
        ) : (
          <>
            <button type="button" className="layer-main" aria-pressed={active} title={locked} onClick={locked ? undefined : onOpen} onDoubleClick={fn && !locked ? () => setEditing(name) : undefined} data-testid="graph-open">
              <Workflow size={14} aria-hidden="true" className="type-icon" />
              <span className="layer-name">{name}</span>
              {!fn && <span className="layer-type">{scope === 'menu' ? strings.nav.menuGraph : scope === 'blueprint' ? strings.nav.componentGraph : strings.nav.layerGraph}</span>}
            </button>
            <span className="graph-row-actions">
              {fn ? (
                locked ? <span className="row-reveal">{extra}</span> : confirm ? confirmButtons : (
                  // a function row stays quiet until it is hovered or focused: its extra action, then "..." with rename and delete
                  <span className="row-reveal">
                    {extra}
                    <RowMenu label={strings.lib.more} testId="graph-more" items={[{ label: strings.lib.rename, onClick: () => setEditing(name) }, ...(moves ?? []), { label: strings.lib.delete, danger: true, onClick: () => setConfirm(true) }]} />
                  </span>
                )
              ) : (
                <>
                  <Btn icon={Pencil} variant="quiet" label={strings.nav.renameGraph} onClick={() => setEditing(name)} testId="graph-rename" />
                  {confirm ? confirmButtons : <Btn icon={Trash2} variant="quiet" className="btn-hover-err" label={strings.nav.deleteGraph(name)} onClick={() => setConfirm(true)} testId="graph-delete" />}
                  {extra}
                </>
              )}
            </span>
          </>
        )}
      </div>
      {sigText && <div className="graph-row-events dim" data-testid="function-signature">{sigText}</div>}
      {events.length > 0 && <div className="graph-row-events dim">{events.join(' · ')}</div>}
    </li>
  )
}
