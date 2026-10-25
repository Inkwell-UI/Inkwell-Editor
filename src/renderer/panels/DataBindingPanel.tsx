import { TriangleAlert } from 'lucide-react'
import { scriptsOf } from '../../shared/graphs'
import { BINDABLE, mockDataOf, parseBindings, withBinding, type BindProp } from '../../shared/graphBinding'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useActiveOverlay, useActiveSwf } from '../hooks/useProject'
import { bindableVariables, bindingTypeOk, mockType } from '../model/variables'
import { openGraphs } from '../state/graphDocs'
import { editNode } from '../state/overlayStore'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../strings'
import { Panel } from './Panel'

/**
 * Data binding (design spec, Overlay `dataBinding`): binds a property of the selected component (text, visible, alpha, tint) to a graph variable or a
 * mock data field. The choice is written to the layer's overlay entry through `editNode` (one history entry of the SWF); the string format is in
 * `shared/graphBinding.ts`. Mock data feeds Ruffle Play mode only (Mock Data tab).
 */
export function DataBindingPanel() {
  const swf = useActiveSwf()
  const overlay = useActiveOverlay()
  const component = useSelectionStore((s) => s.component)
  const { ids } = useSwfGraphs() // loads the graphs; their variables are read below
  const node = component && swf ? swf.ir.nodes[component] : undefined
  if (!swf || !node) return <Panel title={strings.bind.title}><p className="empty">{strings.bind.none}</p></Panel>

  const entry = overlay?.nodes?.[node.id] as { dataBinding?: unknown } | undefined
  const { bindings } = parseBindings(entry?.dataBinding)
  const vars = bindableVariables(openGraphs(swf.id), scriptsOf(entry))
  const mockData = mockDataOf(overlay)
  const set = (prop: BindProp, value: string): void => {
    const next = value === '' ? null : { source: value.startsWith('var:') ? ('var' as const) : ('mock' as const), name: value.slice(value.indexOf(':') + 1) }
    editNode(swf.id, node.id, { dataBinding: withBinding(entry?.dataBinding, prop, next) ?? null })
  }
  return (
    <Panel title={strings.bind.title}>
      <div className="bind" data-testid="binding-panel" data-graphs={ids.length}>
        <p className="bind-head"><strong>{node.name}</strong> <span className="dim">{strings.nav.typeNames[node.type] ?? node.type}</span></p>
        <p className="dim">{strings.bind.help}</p>
        {BINDABLE.map((prop) => {
          const b = bindings.find((x) => x.prop === prop)
          const value = b ? `${b.source}:${b.name}` : ''
          const reason = prop === 'text' && node.type !== 'text' ? strings.bind.textOnly : undefined
          const mocked = b?.source === 'mock' ? mockData[b.name] : undefined
          const type = b ? (b.source === 'var' ? vars.find((v) => v.id === b.name)?.type : mocked === undefined ? undefined : mockType(mocked)) : undefined
          const missing = b !== undefined && type === undefined
          const note = missing ? strings.bind.missing(b.name) : type && !bindingTypeOk(prop, type) ? strings.bind.typeNote(prop, type) : undefined
          return (
            <div className="bind-row" key={prop}>
              <label htmlFor={`bind-${prop}`}>{strings.bind.props[prop]}</label>
              <select id={`bind-${prop}`} className="gn-input" value={value} disabled={reason !== undefined} title={reason} onChange={(e) => set(prop, e.target.value)} data-testid={`bind-${prop}`}>
                <option value="">{strings.bind.unbound}</option>
                {b && missing && <option value={value}>{strings.bind.missing(b.name)}</option>}
                <optgroup label={strings.bind.variables}>
                  {vars.map((v) => <option key={v.id} value={`var:${v.id}`}>{v.name} ({v.type})</option>)}
                </optgroup>
                <optgroup label={strings.bind.mockData}>
                  {Object.entries(mockData).map(([k, v]) => <option key={k} value={`mock:${k}`}>{k} ({mockType(v)})</option>)}
                </optgroup>
              </select>
              {note && <span className="tone-warn bind-warn" role="img" aria-label={note} title={note}><TriangleAlert size={13} aria-hidden="true" /></span>}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
