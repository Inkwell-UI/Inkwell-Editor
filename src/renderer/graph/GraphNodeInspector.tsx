import { incoming, nodeIndex } from '@nicklaj/knotwork'
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useComponentIr } from '../hooks/useComponentIr'
import { useVisibleVariables } from './useVisibleVariables'
import { usePacks } from '../hooks/usePacks'
import { useActiveOverlay, useActiveSwf, useDockRows } from '../hooks/useProject'
import { fieldRows, inspectorText, layerOptions, nodePins } from '../model/graphModel'
import { useComponentGraphs } from '../state/componentGraphs'
import { functionChoices, pinName, pointCall } from '../state/graphStore'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../strings'
import { isFunctionEntry, isFunctionExit } from '../../shared/graphValidate'
import { Copy, LogIn, LogOut } from 'lucide-react'
import { Btn } from '../ui/Btn'
import { OpenComponentProps } from './PropsEditor'
import { PinInputs, PinOutputs, type PinRowsProps } from './PinRows'
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
  const layers = useMemo(() => (comp === 'unavailable' ? [] : comp ? layerOptions(comp.ir, comp.inSwf ? overlay : undefined, true) : swf ? layerOptions(swf.ir, overlay) : []), [comp, swf, overlay])
  const nodes = useStore(store ?? emptyStore, (s) => s.nodes)
  const edges = useStore(store ?? emptyStore, (s) => s.edges)
  const variables = useVisibleVariables(store, swf?.id)
  const signature = useStore(store ?? emptyStore, (s) => s.signature)
  const props = useStore(store ?? emptyStore, (s) => s.props)
  const componentGraphs = useComponentGraphs((s) => s.graphs)
  const node = nodeId ? nodeIndex(nodes).get(nodeId) : undefined
  if (!store || !node || !swf) return <OpenComponentProps><p className="empty">{strings.insp.gnNone}</p></OpenComponentProps>
  const def = defs.get(node.data.kind)
  const mine = rows.filter((r) => r.swfName === swf.name && r.graphId === activeId && r.graphNodeId === node.id)
  const pins = def ? nodePins(defs, node, variables, signature) : undefined
  const wired = new Set(incoming(edges, node.id).map((e) => pinName(e.targetHandle)))
  const { callsFunction: callKey, readsProp: propKey } = (def?.extra ?? {}) as { callsFunction?: string; readsProp?: string }
  const list = def && pins ? fieldRows(def, node, pins, wired, { sig: signature, props, components: Object.values(componentGraphs).map((g) => ({ id: g.component!, name: g.name })), functions: callKey ? functionChoices(store) : [] }, true) : []
  const description = def ? inspectorText(def).description : undefined
  const ctx = { setField: (k: string, v: unknown) => (k === callKey && typeof v === 'string' ? pointCall(store, node.id, v) : k === propKey && typeof v === 'string' ? store.getState().setNodeProp(node.id, v) : store.getState().setField(node.id, k, v)), layers, variables }
  const pinProps: PinRowsProps | undefined = def && pins ? { swfId: swf.id, graphId: activeId, store, node, def, defs, nodes, edges, inputs: pins.inputs, outputs: pins.outputs, rows: list, ctx } : undefined
  return (
    <div className="insp insp-node" data-testid="graph-node-inspector">
      <header className="insp-head">
        <h3 className="insp-name">{def?.title ?? strings.graph.unknownNode}</h3>
        <span className="chip">{def?.category ?? '?'}</span>
      </header>
      {description && <p className="dim insp-desc">{description}</p>}
      {mine.length > 0 && (
        <section className="pinrow-section" aria-labelledby="gn-issues">
          <h4 id="gn-issues" className="pinrow-title">{strings.insp.gnIssues(mine.length)}</h4>
          <ul className="plain">{mine.map((r, i) => <li key={i} className="issue"><span className="issue-text"><span className="mono">{r.code}</span><span>{r.message}</span></span></li>)}</ul>
        </section>
      )}
      {def && isFunctionEntry(def) && <SignatureEditor store={store} sections={['inputs']} />}
      {def && isFunctionExit(def) && <SignatureEditor store={store} sections={['outputs', 'exits']} />}
      {def && pins && pinProps && (
        <>
          {(pins.inputs.length > 0 || list.length > 0) && (
            <section className="pinrow-section" aria-labelledby="gn-inputs">
              <h4 id="gn-inputs" className="pinrow-title"><LogIn size={14} aria-hidden="true" />{strings.insp.gnInputs}</h4>
              <PinInputs {...pinProps} />
            </section>
          )}
          {pins.outputs.length > 0 && (
            <section className="pinrow-section" aria-labelledby="gn-outputs">
              <h4 id="gn-outputs" className="pinrow-title"><LogOut size={14} aria-hidden="true" />{strings.insp.gnOutputs}</h4>
              <PinOutputs {...pinProps} />
            </section>
          )}
        </>
      )}
      <footer className="insp-foot" data-testid="graph-node-ids">
        <span className="mono" title={strings.insp.gnId(node.id)}>{node.data.kind} · {node.id.slice(0, 8)}</span>
        <Btn icon={Copy} label={strings.insp.gnCopyId} variant="quiet" onClick={() => void navigator.clipboard?.writeText(node.id).catch(() => undefined)} />
      </footer>
    </div>
  )
}

import { create } from 'zustand'
import type { GraphState } from '../state/graphStore'
const emptyStore = create<Pick<GraphState, 'nodes' | 'edges' | 'variables' | 'signature' | 'props'>>(() => ({ nodes: [], edges: [], variables: [], signature: undefined, props: undefined }))
