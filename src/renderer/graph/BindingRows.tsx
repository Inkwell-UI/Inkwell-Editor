import { Link, TriangleAlert, X } from 'lucide-react'
import type { Node } from '@inkwell-ui/spec'
import { scriptsOf } from '../../shared/graphs'
import { BINDABLE, mockDataOf, parseBindings, withBinding, type BindProp } from '../../shared/graphBinding'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useActiveOverlay } from '../hooks/useProject'
import { bindableVariables, bindingTypeOk, mockType } from '../model/variables'
import { openGraphs } from '../state/graphDocs'
import { editNode } from '../state/overlayStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Popover } from '../ui/Popover'

/** What the design says for a property, shown dim while nothing is bound. */
function designValue(prop: BindProp, node: Node): string {
  if (prop === 'text') return node.type === 'text' ? node.content : ''
  if (prop === 'visible') return node.visible ? strings.yes : strings.no
  if (prop === 'alpha') return String(Math.round(node.opacity * 100)) // the design says 0..1, a bound alpha is 0..100
  return strings.bind.noTint
}

/**
 * The Inspector's Data section: one row per bindable property (text, visible, alpha, tint). An unbound row shows the design's value and a link button that opens
 * the variable list; a bound row shows the source and an unlink button. It edits the same overlay `dataBinding` string as the Data Binding panel (`editNode`, one
 * history entry); the property rules (a variable of the menu graph or of a graph attached to the layer, mock data = preview only) are the panel's.
 */
export function BindingRows({ swfId, node }: { swfId: string; node: Node }) {
  const overlay = useActiveOverlay()
  const { ids } = useSwfGraphs() // loads the graphs; their variables are read below
  const entry = overlay?.nodes?.[node.id] as { dataBinding?: unknown } | undefined
  const { bindings } = parseBindings(entry?.dataBinding)
  const vars = bindableVariables(openGraphs(swfId), scriptsOf(entry))
  const mockData = mockDataOf(overlay)
  // only what the property can be driven by is offered (arrays and objects never)
  const fitVars = (prop: BindProp) => vars.filter((x) => bindingTypeOk(prop, x.type))
  const fitMock = (prop: BindProp) => Object.entries(mockData).filter(([, m]) => bindingTypeOk(prop, mockType(m)))
  const set = (prop: BindProp, source: 'var' | 'mock' | null, name = ''): void =>
    editNode(swfId, node.id, { dataBinding: withBinding(entry?.dataBinding, prop, source ? { source, name } : null) ?? null })
  return (
    <div data-testid="binding-rows" data-graphs={ids.length}>
      {BINDABLE.map((prop) => {
        const b = bindings.find((x) => x.prop === prop)
        const label = strings.bind.props[prop]!
        const reason = prop === 'text' && node.type !== 'text' ? strings.bind.textOnly : undefined
        const v = b?.source === 'var' ? vars.find((x) => x.id === b.name) : undefined
        const mocked = b?.source === 'mock' ? mockData[b.name] : undefined
        const type = v?.type ?? (mocked === undefined ? undefined : mockType(mocked))
        const note = b && type === undefined ? strings.bind.missing(b.name) : type && !bindingTypeOk(prop, type) ? strings.bind.typeNote(label, type) : undefined
        return (
          <div className="bindfld" key={prop} data-testid={`bindfld-${prop}`}>
            <span className="field-label">{label}</span>
            {b ? (
              <span className="bindfld-value is-bound" title={b.source === 'mock' ? strings.bind.previewOnlyHelp : undefined}>
                <b>{v?.name ?? b.name}</b>
                {type && <span className="dim">{type}</span>}
                {b.source === 'mock' && <span className="chip chip-warn">{strings.bind.previewOnly}</span>}
                {note && <span className="tone-warn bindfld-warn" role="img" aria-label={note} title={note}><TriangleAlert size={13} aria-hidden="true" /></span>}
              </span>
            ) : (
              <span className="bindfld-value is-plain dim" title={strings.bind.fromDesign}>{designValue(prop, node) || strings.bind.emptyValue}</span>
            )}
            {b ? (
              <Btn icon={X} label={strings.bind.unlink(label)} variant="quiet" className="btn-hover-err"onClick={() => set(prop, null)} testId={`bindfld-${prop}-unlink`} />
            ) : (
              <Popover
                align="end"
                label={strings.bind.popTitle(label)}
                className="bindfld-pop"
                trigger={(p) => <Btn icon={Link} label={strings.bind.link(label)} reason={reason} variant="quiet" expanded={p['aria-expanded']} haspopup="dialog" onClick={p.onClick} testId={`bindfld-${prop}-link`} />}
              >
                {(close) => (
                  <div className="bindfld-list">
                    <h4 className="bindfld-group">{strings.bind.variables}</h4>
                    {fitVars(prop).length === 0 && <p className="dim">{strings.bind.noVariables}</p>}
                    <ul className="plain menu">
                      {fitVars(prop).map((x) => <li key={x.id}><button type="button" onClick={() => { set(prop, 'var', x.id); close() }}>{x.name} <span className="dim">{x.type}</span></button></li>)}
                    </ul>
                    {fitMock(prop).length > 0 && (
                      <>
                        <h4 className="bindfld-group">{strings.bind.mockData}</h4>
                        <ul className="plain menu">
                          {fitMock(prop).map(([k, m]) => <li key={k}><button type="button" onClick={() => { set(prop, 'mock', k); close() }}>{k} <span className="dim">{mockType(m)}</span></button></li>)}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </Popover>
            )}
          </div>
        )
      })}
    </div>
  )
}
