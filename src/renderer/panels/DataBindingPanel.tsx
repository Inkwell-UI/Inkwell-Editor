import { TriangleAlert, X } from 'lucide-react'
import { scriptsOf } from '../../shared/graphs'
import { mockDataOf, parseBindings, withBinding, type Binding } from '../../shared/graphBinding'
import type { OverlayDoc } from '../../shared/overlay'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useActiveOverlay, useActiveSwf } from '../hooks/useProject'
import { PIN_STYLE } from '../model/graphModel'
import { bindableVariables, bindingTypeOk, mockType } from '../model/variables'
import { openGraphs } from '../state/graphDocs'
import { editNode } from '../state/overlayStore'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../../shared/strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

type Entry = { dataBinding?: unknown }
const boundLayers = (overlay: OverlayDoc | undefined) =>
  Object.entries((overlay?.nodes ?? {}) as Record<string, Entry>).flatMap(([id, entry]) => {
    const bindings = parseBindings(entry.dataBinding).bindings
    return bindings.length ? [{ id, entry, bindings }] : []
  })

/** Tab label with the number of bound properties. */
export function useBindingTab(): { label: string } {
  const n = boundLayers(useActiveOverlay()).reduce((sum, l) => sum + l.bindings.length, 0)
  return { label: n ? strings.bind.tab(n) : strings.bind.title }
}

interface Use { layerId: string; layer: string | undefined; entry: Entry; binding: Binding; note: string | undefined }
interface Group { key: string; label: string; type: string | undefined; mock: boolean; missing: boolean; uses: Use[] }

/**
 * Data binding overview: every variable (or mock field) that drives a property, with the layers and properties it drives (design spec, Overlay `dataBinding`;
 * string format in `shared/graphBinding.ts`). Bindings are made in the Inspector's Data section (`graph/BindingRows.tsx`); here a layer name selects the
 * layer and a binding can be removed. A binding whose variable is gone, whose type no longer fits or whose layer was deleted carries a warning.
 */
export function DataBindingPanel() {
  const swf = useActiveSwf()
  const overlay = useActiveOverlay()
  const selected = useSelectionStore((s) => s.component)
  const selectComponent = useSelectionStore((s) => s.selectComponent)
  const { ids } = useSwfGraphs() // loads the graphs; their variables are read below
  if (!swf) return <Panel title={strings.bind.title}><p className="empty">{strings.bind.empty}</p></Panel>

  const graphs = openGraphs(swf.id)
  const mockData = mockDataOf(overlay)
  const groups = new Map<string, Group>()
  for (const l of boundLayers(overlay)) {
    const vars = bindableVariables(graphs, scriptsOf(l.entry))
    for (const b of l.bindings) {
      const v = b.source === 'var' ? vars.find((x) => x.id === b.name) : undefined
      const mocked = b.source === 'mock' ? mockData[b.name] : undefined
      const type = v?.type ?? (mocked === undefined ? undefined : mockType(mocked))
      const layer = swf.ir.nodes[l.id]?.name
      const note = type === undefined ? strings.bind.missing(b.name) : !bindingTypeOk(b.prop, type) ? strings.bind.typeNote(strings.bind.props[b.prop]!, type) : layer === undefined ? strings.bind.layerGone : undefined
      const key = `${b.source}:${b.name}`
      const g = groups.get(key) ?? { key, label: v?.name ?? b.name, type, mock: b.source === 'mock', missing: type === undefined, uses: [] }
      if (type !== undefined) Object.assign(g, { label: v?.name ?? b.name, type, missing: false })
      g.uses.push({ layerId: l.id, layer, entry: l.entry, binding: b, note })
      groups.set(key, g)
    }
  }
  const sorted = [...groups.values()].sort((a, b) => Number(b.missing) - Number(a.missing) || a.label.localeCompare(b.label))

  return (
    <Panel title={strings.bind.title}>
      <div className="bindov" data-testid="binding-panel" data-graphs={ids.length}>
        {sorted.length === 0 ? (
          <p className="empty">{strings.bind.empty}</p>
        ) : (
          <div className="bindov-vars">
            {sorted.map((g) => (
              <div className="bindov-var" key={g.key} data-testid={`bindov-${g.key}`}>
                <div className="bindov-head">
                  <span className="var-chip-dot" style={{ background: g.type ? PIN_STYLE[g.type as keyof typeof PIN_STYLE]?.color : undefined }} aria-hidden="true" />
                  <b>{g.label}</b>
                  {g.type && <span className="dim">{g.type}</span>}
                  {g.mock && <span className="chip chip-warn" title={strings.bind.previewOnlyHelp}>{strings.bind.previewOnly}</span>}
                  {g.missing && <span className="tone-warn bind-warn" role="img" aria-label={strings.bind.missing(g.label)} title={strings.bind.missing(g.label)}><TriangleAlert size={13} aria-hidden="true" /></span>}
                  <span className="bindov-n dim">{strings.bind.uses(g.uses.length)}</span>
                </div>
                {g.uses.map((u) => {
                  const prop = strings.bind.props[u.binding.prop]!
                  return (
                    <div className="bindov-use" key={`${u.layerId}/${u.binding.prop}`}>
                      {u.layer !== undefined
                        ? <button type="button" className={`row-link bindov-layer${u.layerId === selected ? ' is-current' : ''}`} onClick={() => selectComponent(u.layerId, 'navigator')}>{u.layer}</button>
                        : <span className="dim">{strings.bind.layerGone}</span>}
                      <span className="dim">{prop}</span>
                      {u.note && !g.missing && <span className="tone-warn bind-warn" role="img" aria-label={u.note} title={u.note}><TriangleAlert size={13} aria-hidden="true" /></span>}
                      <Btn icon={X} label={strings.bind.unlink(prop)} variant="quiet" className="bindov-unlink btn-hover-err" testId={`bindov-${u.layerId}-${u.binding.prop}-unlink`}
                        onClick={() => editNode(swf.id, u.layerId, { dataBinding: withBinding(u.entry.dataBinding, u.binding.prop, null) ?? null })} />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}
