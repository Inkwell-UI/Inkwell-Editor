import { useEffect, useMemo, useState } from 'react'
import { SplitSquareHorizontal, Zap } from 'lucide-react'
import { nodeIndex } from '@nicklaj/knotwork'
import { useStore } from 'zustand'
import { As2View } from '../graph/As2View'
import { GraphCanvas } from '../graph/GraphCanvas'
import { useGraphActions } from '../graph/useGraphActions'
import { useSwfGraphs } from '../hooks/useGraphs'
import { usePacks } from '../hooks/usePacks'
import { useActiveOverlay, useActiveSwf } from '../hooks/useProject'
import { eventNodes } from '../model/graphModel'
import { tidyPositions } from '../model/graphLayout'
import { ownersOfGraph } from '../model/graphNav'
import { menuGraphId, setActiveGraph } from '../state/graphDocs'
import type { GraphStore } from '../state/graphStore'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/**
 * Zone 4: the Knotwork graph of the active SWF's open graph (UX 4.4): breadcrumb (SWF > graph > layer > node; the segments are links), the event jump
 * list, the canvas, and the AS2 split view (`graph/As2View.tsx`: generated class, selected node's lines highlighted, click a line to select its node). Which graph is open is `state/graphDocs`:
 * the Navigator's Graphs section sets it, and selecting a component that has a graph opens that graph (bridge).
 */
export function GraphPanel() {
  const swf = useActiveSwf()
  const { activeId, store, loaded } = useSwfGraphs()
  const actions = useGraphActions()
  const [split, setSplit] = useState(false)
  const [tidied, setTidied] = useState(0) // bumps the canvas to fit the view after a tidy
  const tidy = (): void => {
    if (!store) return
    const s = store.getState()
    s.moveNodes(tidyPositions(s.nodes, s.edges)) // one update = one undo entry
    setTidied((n) => n + 1)
  }
  return (
    <Panel
      title={strings.graph.title}
      actions={
        <>
          <Btn label={strings.graph.tidy} onClick={tidy} reason={store ? undefined : strings.nav.noSwf} testId="graph-tidy">{strings.graph.tidy}</Btn>
          <Btn icon={SplitSquareHorizontal} pressed={split} onClick={() => setSplit(!split)} label={strings.graph.as2Split} testId="as2-split">{strings.graph.as2Split}</Btn>
        </>
      }
    >
      <div className="graph">
        {!swf ? (
          <p className="empty">{strings.nav.noSwf}</p>
        ) : !loaded ? (
          <p className="empty">{strings.graph.loading}</p>
        ) : !store || !activeId ? (
          <div className="graph-empty" data-testid="graph-empty">
            <p className="empty">{strings.graph.empty}</p>
            <Btn variant="primary" testId="graph-add" onClick={() => void actions.add()} reason={actions.canAdd}>{strings.nav.addGraphShort}</Btn>
            {actions.error && <p className="tone-error">{actions.error}</p>}
          </div>
        ) : (
          <OpenGraph key={`${swf.id}/${activeId}`} store={store} graphId={activeId} split={split} tidied={tidied} />
        )}
      </div>
    </Panel>
  )
}

function OpenGraph({ store, graphId, split, tidied }: { store: GraphStore; graphId: string; split: boolean; tidied: number }) {
  const swf = useActiveSwf()!
  const overlay = useActiveOverlay()
  const defs = usePacks()
  const name = useStore(store, (s) => s.name)
  const nodes = useStore(store, (s) => s.nodes)
  const selectedNode = useSelectionStore((s) => s.graphNode)
  const selectComponent = useSelectionStore((s) => s.selectComponent)
  const reveal = useSelectionStore((s) => s.reveal)
  const revealNode = useSelectionStore((s) => s.revealGraphNode)
  const [focus, setFocus] = useState<{ id: string; n: number }>()
  // a Lint row, trace line or AS2 line pointed at a node of this graph: select it and centre the canvas on it
  useEffect(() => {
    if (reveal && reveal.graph === graphId && nodeIndex(store.getState().nodes).has(reveal.node)) setFocus({ id: reveal.node, n: reveal.n })
  }, [reveal, graphId, store])
  const events = useMemo(() => eventNodes(defs, nodes), [defs, nodes])
  const owner = ownersOfGraph(overlay, graphId).find((id) => id !== swf.ir.root && swf.ir.nodes[id])
  const node = selectedNode ? nodeIndex(nodes).get(selectedNode) : undefined
  const nodeTitle = node ? (defs.get(node.data.kind)?.title ?? node.data.kind) : undefined
  const menu = menuGraphId(swf.id)
  return (
    <>
      <nav className="breadcrumb" aria-label={strings.graph.breadcrumbLabel}>
        <span>{strings.graph.crumbRoot}</span>
        <button type="button" className="row-link" onClick={() => menu && setActiveGraph(swf.id, menu)} disabled={!menu} data-testid="crumb-swf">{swf.name}</button>
        <span aria-hidden="true">&gt;</span><span data-testid="crumb-graph">{name}</span>
        {owner && <><span aria-hidden="true">&gt;</span><button type="button" className="row-link" onClick={() => selectComponent(owner, 'navigator')}>{swf.ir.nodes[owner]?.name}</button></>}
        {nodeTitle && <><span aria-hidden="true">&gt;</span><span>{nodeTitle}</span></>}
        <label className="events-jump">
          <Zap size={12} aria-hidden="true" />
          <select aria-label={strings.graph.events} value="" onChange={(e) => e.target.value && setFocus({ id: e.target.value, n: (focus?.n ?? 0) + 1 })} data-testid="event-jump">
            <option value="">{strings.graph.eventsCount(events.length)}</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.detail ? `${ev.title}: ${ev.detail}` : ev.title}</option>)}
          </select>
        </label>
      </nav>
      <div className={`graph-body${split ? ' is-split' : ''}`}>
        <GraphCanvas swf={swf} overlay={overlay} store={store} defs={defs} focusNode={focus} fitSignal={tidied} />
        {split && (
          <As2View swfName={swf.name} store={store} selectedNode={selectedNode} onPick={(id) => revealNode(graphId, id)} />
        )}
      </div>
    </>
  )
}
