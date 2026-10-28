import { incoming, nodeIndex } from '@nicklaj/knotwork'
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useComponentIr } from '../hooks/useComponentIr'
import { usePacks } from '../hooks/usePacks'
import { useActiveOverlay, useActiveSwf, useDockRows } from '../hooks/useProject'
import { fieldRows, layerOptions, nodePins } from '../model/graphModel'
import { functionChoices, pinName, pointCall } from '../state/graphStore'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../strings'
import { isFunctionEntry, isFunctionExit } from '../../shared/graphValidate'
import { FieldEditor } from './FieldEditors'
import { OpenComponentProps } from './PropsEditor'
import { SignatureEditor } from './SignatureEditor'

/** The Inspector body for a selected graph node (UX 4.5): its kind, the issues pinned to it (the one lint source) and the same field editors as the node. */
export function GraphNodeInspector() {
  const swf = useActiveSwf()
  const overlay = useActiveOverlay()
  const defs = usePacks()
  const { store, activeId } = useSwfGraphs()
  const nodeId = useSelectionStore((s) => s.graphNode)
  const rows = useDockRows()
  const comp = useComponentIr()
  const layers = useMemo(() => (comp === 'unavailable' ? [] : comp ? layerOptions(comp.ir, comp.inSwf ? overlay : undefined) : swf ? layerOptions(swf.ir, overlay) : []), [comp, swf, overlay])
  const nodes = useStore(store ?? emptyStore, (s) => s.nodes)
  const variables = useStore(store ?? emptyStore, (s) => s.variables)
  const signature = useStore(store ?? emptyStore, (s) => s.signature)
  const props = useStore(store ?? emptyStore, (s) => s.props)
  const node = nodeId ? nodeIndex(nodes).get(nodeId) : undefined
  if (!store || !node || !swf) return <OpenComponentProps><p className="empty">{strings.insp.gnNone}</p></OpenComponentProps>
  const def = defs.get(node.data.kind)
  const mine = rows.filter((r) => r.swfName === swf.name && r.graphId === activeId && r.graphNodeId === node.id)
  const pins = def ? nodePins(defs, node, variables, signature) : undefined
  const wired = new Set(incoming(store.getState().edges, node.id).map((e) => pinName(e.targetHandle)))
  const { callsFunction: callKey, readsProp: propKey } = (def?.extra ?? {}) as { callsFunction?: string; readsProp?: string }
  const list = def && pins ? fieldRows(def, node, pins, wired, { sig: signature, props, functions: callKey ? functionChoices(store) : [] }) : []
  const ctx = { setField: (k: string, v: unknown) => (k === callKey && typeof v === 'string' ? pointCall(store, node.id, v) : k === propKey && typeof v === 'string' ? store.getState().setNodeProp(node.id, v) : store.getState().setField(node.id, k, v)), layers, variables }
  return (
    <div className="insp" data-testid="graph-node-inspector">
      <header className="insp-head">
        <div>
          <h3 className="insp-name">{def?.title ?? strings.graph.unknownNode}</h3>
          <span className="dim mono">{strings.insp.gnId(node.id)}</span>
        </div>
        <span className="chip">{def?.category ?? '?'}</span>
      </header>
      <p className="dim mono">{strings.insp.gnKind}: {node.data.kind}</p>
      <section aria-labelledby="gn-issues">
        <h4 id="gn-issues">{strings.insp.gnIssues(mine.length)}</h4>
        {mine.length === 0 && <p className="empty">{strings.insp.noIssues}</p>}
        <ul className="plain">{mine.map((r, i) => <li key={i} className="issue"><span className="issue-text"><span className="mono">{r.code}</span><span>{r.message}</span></span></li>)}</ul>
      </section>
      {def && isFunctionEntry(def) && <SignatureEditor store={store} sections={['inputs']} />}
      {def && isFunctionExit(def) && <SignatureEditor store={store} sections={['outputs', 'exits']} />}
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
const emptyStore = create<Pick<GraphState, 'nodes' | 'variables' | 'signature' | 'props'>>(() => ({ nodes: [], variables: [], signature: undefined, props: undefined }))
