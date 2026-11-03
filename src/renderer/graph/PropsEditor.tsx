import type { ReactNode } from 'react'
import { Box, Plus, X } from 'lucide-react'
import { FUNCTION_PIN_TYPES } from '@inkwell-ui/spec'
import { useStore } from 'zustand'
import { strings } from '../../shared/strings'
import type { GraphStore } from '../state/graphStore'
import { useSwfGraphs } from '../hooks/useGraphs'
import { PROP_DRAG } from '../state/componentGraphs'
import { PIN_STYLE } from '../model/graphModel'
import { InspCard, InspFoot, InspHeader } from '../ui/InspParts'
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

/** The props of the open graph when it is a component's graph, else `children`: the Inspector shows it while nothing is selected. */
export function OpenComponentProps({ children }: { children?: ReactNode }) {
  const { store } = useSwfGraphs()
  return store && store.getState().meta.scope === 'blueprint' ? <PropsEditor store={store} /> : <>{children}</>
}

/** The data a component takes (its props), in the Inspector while a component's graph is open: name, type, default. Every change is one `setProps` (undoable). */
export function PropsEditor({ store }: { store: GraphStore }) {
  const props = useStore(store, (s) => s.props)
  const name = useStore(store, (s) => s.name)
  const meta: { component?: unknown } = store.getState().meta
  const component = typeof meta.component === 'string' ? meta.component : undefined
  if (!props) return null
  const set = (next: Prop[]): void => store.getState().setProps(next)
  const patch = (i: number, p: Partial<Prop>): void => set(props.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const fresh = (): string => {
    for (let k = props.length + 1; ; k++) if (!propNameProblem(props, -1, `prop${k}`)) return `prop${k}`
  }
  return (
    <div className="insp insp-fill" data-testid="props-editor">
      <InspHeader title={name} sub={strings.insp.componentKind} />
      <InspCard title={strings.graph.propsTitle} icon={Box}>
        <div className="props-editor">
        {props.length === 0 && <p className="empty">{strings.graph.propsEmpty}</p>}
        {props.map((p, i) => (
          <div className="props-block" key={p.id} data-testid={`prop-${p.name}`}>
            <div className="props-block-head" draggable title={strings.graph.propDrag} onDragStart={(e) => { e.dataTransfer.setData(PROP_DRAG, p.id); e.dataTransfer.effectAllowed = 'link' }}>
              <span className="props-block-title"><span className="var-chip-dot" style={{ background: PIN_STYLE[p.type]?.color }} aria-hidden="true" /><b>{p.name}</b> <span className="dim">{p.type}</span></span>
              <button type="button" className="gn-icon btn-hover-err" title={strings.graph.sigRemove(p.name)} aria-label={strings.graph.sigRemove(p.name)} onClick={() => set(props.filter((_, j) => j !== i))}><X size={12} aria-hidden="true" /></button>
            </div>
            <div className="props-block-grid">
              <label className="gn-field"><span className="gn-field-label">{strings.graph.sigName}</span>
                <NameBox value={p.name} label={strings.graph.sigName} problem={(n) => propNameProblem(props, i, n)} onCommit={(name) => patch(i, { name })} />
              </label>
              <label className="gn-field"><span className="gn-field-label">{strings.graph.sigType}</span>
                <select className="gn-input" aria-label={strings.graph.sigType} value={p.type} onChange={(e) => { const type = e.target.value as Prop['type']; patch(i, { type, default: zero(type) }) }}>
                  {FUNCTION_PIN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
            {p.type === 'Bool' ? (
              <label className="check"><input type="checkbox" checked={p.default === true} onChange={(e) => patch(i, { default: e.target.checked })} />{strings.graph.propDefault}</label>
            ) : p.type === 'Number' || p.type === 'String' ? (
              <label className="gn-field"><span className="gn-field-label">{strings.graph.propDefault}</span>
                {p.type === 'Number'
                  ? <input className="gn-input" type="number" value={typeof p.default === 'number' ? p.default : 0} onChange={(e) => patch(i, { default: Number(e.target.value) })} />
                  : <input className="gn-input" value={typeof p.default === 'string' ? p.default : ''} onChange={(e) => patch(i, { default: e.target.value })} />}
              </label>
            ) : null}
          </div>
        ))}
        <button type="button" className="gn-add" onClick={() => set([...props, { id: crypto.randomUUID(), name: fresh(), type: 'String', default: '' }])}>
          <Plus size={12} aria-hidden="true" />{strings.graph.propAdd}
        </button>
        </div>
      </InspCard>
      {component && <InspFoot text={`${strings.insp.componentKind} · ${component.slice(0, 8)}`} title={component} copy={component} />}
    </div>
  )
}
