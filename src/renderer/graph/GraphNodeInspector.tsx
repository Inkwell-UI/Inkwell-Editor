import { nodeIndex } from '@nicklaj/knotwork'
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { useSwfGraphs } from '../hooks/useGraphs'
import { usePacks } from '../hooks/usePacks'
import { useActiveOverlay, useActiveSwf, useDockRows } from '../hooks/useProject'
import { fieldRows, layerOptions, nodePins } from '../model/graphModel'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../strings'
import { FieldEditor } from './FieldEditors'

/** The Inspector body for a selected graph node (UX 4.5): its kind, the issues pinned to it (the one lint source) and the same field editors as the node. */
export function GraphNodeInspector() {
  const swf = useActiveSwf()
  const overlay = useActiveOverlay()
  const defs = usePacks()
  const { store, activeId } = useSwfGraphs()
  const nodeId = useSelectionStore((s) => s.graphNode)
  const rows = useDockRows()
  const layers = useMemo(() => (swf ? layerOptions(swf.ir, overlay) : []), [swf, overlay])
  const nodes = useStore(store ?? emptyStore, (s) => s.nodes)
  const variables = useStore(store ?? emptyStore, (s) => s.variables)
  const node = nodeId ? nodeIndex(nodes).get(nodeId) : undefined
  if (!store || !node || !swf) return <p className="empty">{strings.insp.gnNone}</p>
  const def = defs.get(node.data.kind)
  const mine = rows.filter((r) => r.swfName === swf.name && r.graphId === activeId && r.graphNodeId === node.id)
  const pins = def ? nodePins(defs, node, variables) : undefined
  const wired = new Set(store.getState().edges.filter((e) => e.target === node.id).map((e) => (e.targetHandle ?? '').replace(/-in$/, '')))
  const list = def && pins ? fieldRows(def, node, pins, wired) : []
  const ctx = { setField: (k: string, v: unknown) => store.getState().setField(node.id, k, v), layers, variables }
  return (
    <div className="insp" data-testid="graph-node-inspector">
      <header className="insp-head">
        <div>
          <h3 className="insp-name">{def?.title ?? strings.graph.unknownNode}</h3>
          <span className="dim mono">{strings.insp.nodeId(node.id)}</span>
        </div>
        <span className="chip">{def?.category ?? '?'}</span>
      </header>
      <p className="dim mono">{strings.insp.gnKind}: {node.data.kind}</p>
      <section aria-labelledby="gn-issues">
        <h4 id="gn-issues">{strings.insp.gnIssues(mine.length)}</h4>
        {mine.length === 0 && <p className="empty">{strings.insp.noIssues}</p>}
        <ul className="plain">{mine.map((r, i) => <li key={i} className="issue">{r.message}</li>)}</ul>
      </section>
      {list.length > 0 && (
        <section aria-labelledby="gn-fields">
          <h4 id="gn-fields">{strings.insp.gnFields}</h4>
          {list.map((r) => <FieldEditor key={r.key} row={r} ctx={ctx} />)}
        </section>
      )}
    </div>
  )
}

import { create } from 'zustand'
import type { GraphState } from '../state/graphStore'
const emptyStore = create<Pick<GraphState, 'nodes' | 'variables'>>(() => ({ nodes: [], variables: [] }))
