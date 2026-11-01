import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useStore } from 'zustand'
import { PIN_STYLE } from '../model/graphModel'
import { defaultFor, newVariableId, parseJsonDefault, savedTypeError, SAVED_VARIABLE_TYPES, VARIABLE_DRAG, variableDragData, VARIABLE_TYPES } from '../model/variables'
import { openGraphs } from '../state/graphDocs'
import { isReadOnlyGraph, type GraphStore } from '../state/graphStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Popover } from '../ui/Popover'

type Variable = ReturnType<GraphStore['getState']>['variables'][number]

/**
 * The open graph's variables as a row of chips under the breadcrumb, so they stay in view while wiring. The dot has the colour of the type's pin; a chip is dragged onto the canvas to get
 * or set it and clicked to edit it (name, type, default, saved, delete). "Add" makes one in the open graph: a menu graph's variable is a menu variable, a component graph's a component one.
 */
export function VariableStrip({ swfId, store }: { swfId: string; store: GraphStore }) {
  const variables = useStore(store, (s) => s.variables)
  const scope = useStore(store, (s) => s.meta.scope)
  const canAdd = !isReadOnlyGraph(store) && (scope === 'menu' || scope === 'component')
  if (!variables.length && !canAdd) return null
  return (
    <div className="var-strip" role="group" aria-label={strings.vars.title} data-testid="variables-panel">
      <span className="var-strip-title">{strings.vars.title}</span>
      {variables.map((v) => (
        <Popover
          key={v.id}
          label={v.name}
          trigger={(p) => (
            <button
              type="button"
              className="var-chip"
              {...p}
              draggable
              title={strings.vars.drag}
              onDragStart={(e) => {
                e.dataTransfer.setData(VARIABLE_DRAG, variableDragData(swfId, v.id))
                e.dataTransfer.effectAllowed = 'link'
              }}
              data-testid={`var-${v.id}`}
            >
              <span className="var-chip-dot" style={{ background: PIN_STYLE[v.type]?.color }} aria-hidden="true" />
              <span className="var-chip-name">{v.name}</span>
              <span className="var-chip-type">{v.type}{v.scope === 'saved' ? ` · ${strings.vars.scopeSaved}` : ''}</span>
            </button>
          )}
        >
          {(close) => <VariableEditor store={store} v={v} canSave={scope === 'menu' && !isReadOnlyGraph(store)} close={close} />}
        </Popover>
      ))}
      {canAdd && (
        <Popover
          align="end"
          label={strings.vars.addVariable}
          trigger={(p) => (
            <button type="button" className="var-chip var-chip-add" {...p} aria-label={strings.vars.addVariable} data-testid="var-toggle">
              <Plus size={13} aria-hidden="true" />
              <span>{strings.vars.add}</span>
            </button>
          )}
        >
          {(close) => <AddVariable swfId={swfId} store={store} close={close} />}
        </Popover>
      )}
    </div>
  )
}

function AddVariable({ swfId, store, close }: { swfId: string; store: GraphStore; close: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<(typeof VARIABLE_TYPES)[number]>('Number')
  const add = (): void => {
    if (!name.trim()) return
    store.getState().addVariable({ id: newVariableId(name, openGraphs(swfId)), name: name.trim(), type, default: defaultFor(type) })
    close()
  }
  return (
    <form className="var-pop" onSubmit={(e) => (e.preventDefault(), add())}>
      <input autoFocus className="gn-input" placeholder={strings.vars.name} aria-label={strings.vars.name} value={name} onChange={(e) => setName(e.target.value)} data-testid="var-name" />
      <select className="gn-input" aria-label={strings.vars.type} value={type} onChange={(e) => setType(e.target.value as typeof type)} data-testid="var-type">
        {VARIABLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <Btn icon={Plus} variant="primary" onClick={add} reason={name.trim() ? undefined : strings.vars.nameFirst} testId="var-add">{strings.vars.add}</Btn>
    </form>
  )
}

function VariableEditor({ store, v, canSave, close }: { store: GraphStore; v: Variable; canSave: boolean; close: () => void }) {
  const a = store.getState()
  const saved = v.scope === 'saved'
  const savedReason = saved ? undefined : savedTypeError(v.type)
  return (
    <div className="var-pop">
      <input className="gn-input" aria-label={strings.vars.name} value={v.name} onChange={(e) => a.updateVariable(v.id, { name: e.target.value })} />
      <select className="gn-input" aria-label={strings.vars.type} value={v.type} onChange={(e) => a.updateVariable(v.id, { type: e.target.value as typeof v.type, default: defaultFor(e.target.value as typeof v.type) })}>
        {(saved ? SAVED_VARIABLE_TYPES : VARIABLE_TYPES).map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <DefaultEditor type={v.type} value={v.default} onChange={(d) => a.updateVariable(v.id, { default: d })} />
      {canSave && !savedReason && (
        <label className="check" title={strings.vars.scopeTip('saved')}>
          <input type="checkbox" checked={saved} onChange={(e) => a.updateVariable(v.id, { scope: e.target.checked ? 'saved' : 'menu' })} />
          {strings.vars.keepSaved}
        </label>
      )}
      <Btn icon={Trash2} variant="danger" label={strings.vars.remove(v.name)} onClick={() => (a.removeVariable(v.id), close())}>{strings.lib.delete}</Btn>
    </div>
  )
}

function DefaultEditor({ type, value, onChange }: { type: string; value: unknown; onChange(v: unknown): void }) {
  const label = strings.vars.default
  if (type === 'Bool') return <label className="check"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />{label}</label>
  if (type === 'Number') return <input className="gn-input" type="number" placeholder={label} aria-label={label} value={typeof value === 'number' ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
  if (type === 'String') return <input className="gn-input" placeholder={label} aria-label={label} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
  if (type === 'Array' || type === 'Object') return <JsonDefault key={type} type={type} value={value} onChange={onChange} />
  return null
}

/** Keeps the typed text so half-written JSON is not lost; the default changes only while the text parses to the right shape. */
function JsonDefault({ type, value, onChange }: { type: 'Array' | 'Object'; value: unknown; onChange(v: unknown): void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? defaultFor(type)))
  const bad = parseJsonDefault(type, text) === undefined
  return (
    <input
      className={bad ? 'gn-input is-invalid' : 'gn-input'} spellCheck={false} placeholder={strings.vars.default} title={strings.vars.defaultJson(type)} aria-label={strings.vars.defaultJson(type)} aria-invalid={bad} value={text}
      onChange={(e) => {
        setText(e.target.value)
        const d = parseJsonDefault(type, e.target.value)
        if (d !== undefined) onChange(d)
      }}
    />
  )
}
