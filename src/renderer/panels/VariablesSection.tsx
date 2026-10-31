import { useState } from 'react'
import { GripVertical, Minus, Plus, Trash2 } from 'lucide-react'
import { useStore } from 'zustand'
import type { Graph } from '@inkwell-ui/spec'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useActiveSwf } from '../hooks/useProject'
import { defaultFor, newVariableId, savedTypeError, SAVED_VARIABLE_TYPES, VARIABLE_DRAG, variableDragData, variableTarget, VARIABLE_TYPES } from '../model/variables'
import { menuGraphId, openGraphs } from '../state/graphDocs'
import { findGraphStore, type GraphStore } from '../state/graphStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'

/**
 * The Logic panel's Variables section: the variables of the graph that is open (graph variables, design spec "Variables"): add (name, type, scope menu | component | saved), rename, retype, default, delete.
 * A menu variable lives in the SWF's menu graph, a component variable in the open component graph (`variableTarget`); edits are graph edits, so they join
 * the SWF's one undo history and are saved with the graph file.
 */
export function VariablesSection() {
  const swf = useActiveSwf()
  const { ids, activeId, loaded } = useSwfGraphs()
  const [name, setName] = useState('')
  const [type, setType] = useState<(typeof VARIABLE_TYPES)[number]>('Number')
  const [picked, setPicked] = useState<'menu' | 'component' | 'saved'>()
  const [adding, setAdding] = useState<boolean>()
  if (!swf) return null
  const activeScope = activeId ? (findGraphStore(swf.id, activeId)?.getState().meta.scope as Graph['scope'] | undefined) : undefined
  const scope = picked ?? (activeScope === 'component' ? 'component' : 'menu') // a new variable goes to the graph that is open unless another scope is picked
  const target = variableTarget(scope, { menuGraphId: menuGraphId(swf.id), activeId, activeScope })
  const add = (): void => {
    if ('reason' in target || !name.trim() || (scope === 'saved' && savedTypeError(type))) return
    const store = findGraphStore(swf.id, target.graphId)
    store?.getState().addVariable({ id: newVariableId(name, openGraphs(swf.id)), name: name.trim(), type, default: defaultFor(type), ...(scope === 'saved' ? { scope } : {}) })
    setName('')
  }
  const reason = 'reason' in target ? target.reason : !name.trim() ? strings.vars.nameFirst : scope === 'saved' ? savedTypeError(type) : undefined
  const openStore = activeId ? findGraphStore(swf.id, activeId) : undefined
  // the add form is closed once there are variables to read; with none it is open, so the first one is one step away
  const count = openStore?.getState().variables.length ?? 0
  const formOpen = adding ?? count === 0
  return (
    <section aria-labelledby="logic-variables" className="vars" data-testid="variables-panel">
      <header className="section-title">
        <h3 id="logic-variables">{strings.vars.title}</h3>
        <Btn icon={formOpen ? Minus : Plus} variant="quiet" label={strings.vars.addVariable} onClick={() => setAdding(!formOpen)} testId="var-toggle" />
      </header>
      {formOpen && <form className="vars-add" onSubmit={(e) => (e.preventDefault(), add())}>
        <input className="gn-input" placeholder={strings.vars.name} aria-label={strings.vars.name} value={name} onChange={(e) => setName(e.target.value)} data-testid="var-name" />
        <select className="gn-input" aria-label={strings.vars.type} value={type} onChange={(e) => setType(e.target.value as typeof type)} data-testid="var-type">
          {VARIABLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="gn-input" aria-label={strings.vars.scope} value={scope} onChange={(e) => setPicked(e.target.value as typeof scope)} data-testid="var-scope">
          <option value="menu">{strings.vars.scopeMenu}</option>
          <option value="component">{strings.vars.scopeComponent}</option>
          <option value="saved">{strings.vars.scopeSaved}</option>
        </select>
        <Btn icon={Plus} variant="primary" onClick={add} reason={reason} testId="var-add">{strings.vars.add}</Btn>
      </form>}
      {loaded && ids.length === 0 && <p className="empty">{strings.vars.noGraph}</p>}
      {openStore && <GraphVariables key={activeId} store={openStore} swfId={swf.id} />}
    </section>
  )
}

function GraphVariables({ store, swfId }: { store: GraphStore; swfId: string }) {
  const scope = useStore(store, (s) => s.meta.scope)
  const variables = useStore(store, (s) => s.variables)
  const a = store.getState()
  return (
    <div className="vars-graph">
      {variables.length === 0 && <p className="empty">{strings.vars.none}</p>}
      {variables.map((v) => (
        <div className="var-row" key={v.id} data-testid={`var-${v.id}`}>
          <div className="var-name">
            <span
              className="var-grip"
              draggable
              title={strings.vars.drag}
              onDragStart={(e) => {
                e.dataTransfer.setData(VARIABLE_DRAG, variableDragData(swfId, v.id))
                e.dataTransfer.effectAllowed = 'link'
              }}
            >
              <GripVertical size={14} aria-hidden="true" />
            </span>
            <input className="gn-input" aria-label={strings.vars.name} value={v.name} onChange={(e) => a.updateVariable(v.id, { name: e.target.value })} />
          </div>
          <div className="var-meta">
            <select className="gn-input" aria-label={strings.vars.type} value={v.type} onChange={(e) => a.updateVariable(v.id, { type: e.target.value as typeof v.type, default: defaultFor(e.target.value as typeof v.type) })}>
              {(v.scope === 'saved' ? SAVED_VARIABLE_TYPES : VARIABLE_TYPES).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <DefaultEditor type={v.type} value={v.default} onChange={(d) => a.updateVariable(v.id, { default: d })} />
            {v.scope !== scope && <span className="chip" title={strings.vars.scopeTip(v.scope)}>{v.scope}</span>}
            <Btn icon={Trash2} label={strings.vars.remove(v.name)} onClick={() => a.removeVariable(v.id)} />
          </div>
        </div>
      ))}
    </div>
  )
}

function DefaultEditor({ type, value, onChange }: { type: string; value: unknown; onChange(v: unknown): void }) {
  const label = strings.vars.default
  if (type === 'Bool') return <input type="checkbox" aria-label={label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
  if (type === 'Number') return <input className="gn-input" type="number" aria-label={label} value={typeof value === 'number' ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
  if (type === 'String') return <input className="gn-input" aria-label={label} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
  return null
}
