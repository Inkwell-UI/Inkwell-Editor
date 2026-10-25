import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useStore } from 'zustand'
import type { Graph } from '@inkwell-ui/spec'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useActiveSwf } from '../hooks/useProject'
import { defaultFor, newVariableId, variableTarget, VARIABLE_TYPES } from '../model/variables'
import { menuGraphId, openGraphs } from '../state/graphDocs'
import { findGraphStore, type GraphStore } from '../state/graphStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/**
 * Variables of the active SWF (graph variables, design spec "Variables"): add (name, type, scope menu | component), rename, retype, default, delete.
 * A menu variable lives in the SWF's menu graph, a component variable in the open component graph (`variableTarget`); edits are graph edits, so they join
 * the SWF's one undo history and are saved with the graph file.
 */
export function VariablesPanel() {
  const swf = useActiveSwf()
  const { ids, activeId, loaded } = useSwfGraphs()
  const [name, setName] = useState('')
  const [type, setType] = useState<(typeof VARIABLE_TYPES)[number]>('Number')
  const [scope, setScope] = useState<'menu' | 'component'>('menu')
  if (!swf) return <Panel title={strings.vars.title}><p className="empty">{strings.nav.noSwf}</p></Panel>
  const activeScope = activeId ? (findGraphStore(swf.id, activeId)?.getState().meta.scope as Graph['scope'] | undefined) : undefined
  const target = variableTarget(scope, { menuGraphId: menuGraphId(swf.id), activeId, activeScope })
  const add = (): void => {
    if ('reason' in target || !name.trim()) return
    const store = findGraphStore(swf.id, target.graphId)
    store?.getState().addVariable({ id: newVariableId(name, openGraphs(swf.id)), name: name.trim(), type, default: defaultFor(type) })
    setName('')
  }
  const reason = 'reason' in target ? target.reason : !name.trim() ? strings.vars.nameFirst : undefined
  const ordered = [...ids].sort((a, b) => Number(findGraphStore(swf.id, a)?.getState().meta.scope !== 'menu') - Number(findGraphStore(swf.id, b)?.getState().meta.scope !== 'menu'))
  return (
    <Panel title={strings.vars.title}>
      <div className="vars" data-testid="variables-panel">
        <form className="vars-add" onSubmit={(e) => (e.preventDefault(), add())}>
          <input className="gn-input" placeholder={strings.vars.name} aria-label={strings.vars.name} value={name} onChange={(e) => setName(e.target.value)} data-testid="var-name" />
          <select className="gn-input" aria-label={strings.vars.type} value={type} onChange={(e) => setType(e.target.value as typeof type)} data-testid="var-type">
            {VARIABLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="gn-input" aria-label={strings.vars.scope} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} data-testid="var-scope">
            <option value="menu">{strings.vars.scopeMenu}</option>
            <option value="component">{strings.vars.scopeComponent}</option>
          </select>
          <Btn icon={Plus} variant="primary" onClick={add} reason={reason} testId="var-add">{strings.vars.add}</Btn>
        </form>
        {loaded && ids.length === 0 && <p className="empty">{strings.vars.noGraph}</p>}
        {ordered.map((id) => {
          const store = findGraphStore(swf.id, id)
          return store ? <GraphVariables key={id} store={store} /> : null
        })}
      </div>
    </Panel>
  )
}

function GraphVariables({ store }: { store: GraphStore }) {
  const graphName = useStore(store, (s) => s.name)
  const scope = useStore(store, (s) => s.meta.scope)
  const variables = useStore(store, (s) => s.variables)
  const a = store.getState()
  return (
    <section className="vars-graph" aria-label={graphName}>
      <h4>{graphName} <span className="dim">({scope === 'menu' ? strings.vars.scopeMenu : strings.vars.scopeComponent})</span></h4>
      {variables.length === 0 && <p className="empty">{strings.vars.none}</p>}
      {variables.map((v) => (
        <div className="var-row" key={v.id} data-testid={`var-${v.id}`}>
          <input className="gn-input" aria-label={strings.vars.name} value={v.name} onChange={(e) => a.updateVariable(v.id, { name: e.target.value })} />
          <select className="gn-input" aria-label={strings.vars.type} value={v.type} onChange={(e) => a.updateVariable(v.id, { type: e.target.value as typeof v.type, default: defaultFor(e.target.value as typeof v.type) })}>
            {VARIABLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <DefaultEditor type={v.type} value={v.default} onChange={(d) => a.updateVariable(v.id, { default: d })} />
          <span className="chip" title={strings.vars.scopeTip(v.scope)}>{v.scope}</span>
          <Btn icon={Trash2} label={strings.vars.remove(v.name)} onClick={() => a.removeVariable(v.id)} />
        </div>
      ))}
    </section>
  )
}

function DefaultEditor({ type, value, onChange }: { type: string; value: unknown; onChange(v: unknown): void }) {
  const label = strings.vars.default
  if (type === 'Bool') return <input type="checkbox" aria-label={label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
  if (type === 'Number') return <input className="gn-input" type="number" aria-label={label} value={typeof value === 'number' ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
  if (type === 'String') return <input className="gn-input" aria-label={label} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
  return <span className="dim mono">{JSON.stringify(value ?? null)}</span>
}
