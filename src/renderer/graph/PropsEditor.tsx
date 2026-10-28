import { Plus, X } from 'lucide-react'
import { FUNCTION_PIN_TYPES } from '@inkwell-ui/spec'
import { useStore } from 'zustand'
import { strings } from '../strings'
import type { GraphStore } from '../state/graphStore'
import { useSwfGraphs } from '../hooks/useGraphs'
import { NameBox } from './SignatureEditor'

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
type Prop = NonNullable<ReturnType<GraphStore['getState']>['props']>[number]

/** Why `name` cannot be the name of prop `index`, or undefined. */
export function propNameProblem(props: readonly Prop[], index: number, name: string): string | undefined {
  if (!IDENT.test(name)) return strings.graph.sigBadName
  if (props.some((p, i) => i !== index && p.name === name)) return strings.graph.sigDuplicate(name)
  return undefined
}

const zero = (t: Prop['type']): unknown => (t === 'Number' ? 0 : t === 'Bool' ? false : t === 'String' ? '' : undefined)

/** The props of the open graph when it is a component's graph, else nothing: the Inspector shows it above whatever is selected. */
export function OpenComponentProps() {
  const { store } = useSwfGraphs()
  return store && store.getState().meta.scope === 'blueprint' ? <PropsEditor store={store} /> : null
}

/** The data a component takes (its props), in the Inspector while a component's graph is open: name, type, default. Every change is one `setProps` (undoable). */
export function PropsEditor({ store }: { store: GraphStore }) {
  const props = useStore(store, (s) => s.props)
  if (!props) return null
  const set = (next: Prop[]): void => store.getState().setProps(next)
  const patch = (i: number, p: Partial<Prop>): void => set(props.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const fresh = (): string => {
    for (let k = props.length + 1; ; k++) if (!propNameProblem(props, -1, `prop${k}`)) return `prop${k}`
  }
  return (
    <section className="props-editor" aria-label={strings.graph.propsTitle} data-testid="props-editor">
      <h4 className="sig-title">{strings.graph.propsTitle}</h4>
      {props.length === 0 && <p className="empty">{strings.graph.propsEmpty}</p>}
      {props.map((p, i) => (
        <div className="gn-param" key={p.id}>
          <NameBox value={p.name} label={strings.graph.sigName} problem={(n) => propNameProblem(props, i, n)} onCommit={(name) => patch(i, { name })} />
          <select className="gn-input" aria-label={strings.graph.sigType} value={p.type} onChange={(e) => { const type = e.target.value as Prop['type']; patch(i, { type, default: zero(type) }) }}>
            {FUNCTION_PIN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {p.type === 'Bool' ? (
            <input type="checkbox" aria-label={strings.graph.propDefault} checked={p.default === true} onChange={(e) => patch(i, { default: e.target.checked })} />
          ) : p.type === 'Number' ? (
            <input className="gn-input" type="number" aria-label={strings.graph.propDefault} value={typeof p.default === 'number' ? p.default : 0} onChange={(e) => patch(i, { default: Number(e.target.value) })} />
          ) : p.type === 'String' ? (
            <input className="gn-input" aria-label={strings.graph.propDefault} value={typeof p.default === 'string' ? p.default : ''} onChange={(e) => patch(i, { default: e.target.value })} />
          ) : <span />}
          <button type="button" className="gn-icon" title={strings.graph.sigRemove(p.name)} aria-label={strings.graph.sigRemove(p.name)} onClick={() => set(props.filter((_, j) => j !== i))}><X size={12} aria-hidden="true" /></button>
        </div>
      ))}
      <button type="button" className="gn-add" onClick={() => set([...props, { id: crypto.randomUUID(), name: fresh(), type: 'String', default: '' }])}>
        <Plus size={12} aria-hidden="true" />{strings.graph.propAdd}
      </button>
    </section>
  )
}
