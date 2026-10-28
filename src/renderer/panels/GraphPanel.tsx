import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, SplitSquareHorizontal } from 'lucide-react'
import { nodeIndex } from '@nicklaj/knotwork'
import { useStore } from 'zustand'
import { As2View } from '../graph/As2View'
import { GraphCanvas } from '../graph/GraphCanvas'
import { useGraphActions } from '../graph/useGraphActions'
import { inkwell } from '../hooks/api'
import { useSwfGraphs } from '../hooks/useGraphs'
import { usePacks } from '../hooks/usePacks'
import { useActiveOverlay, useActiveSwf } from '../hooks/useProject'
import { eventNodes } from '../model/graphModel'
import { tidyPositions } from '../model/graphLayout'
import { ownersOfGraph } from '../model/graphNav'
import { makeFunction, menuGraphId, openGraphs, setActiveGraph, useGraphDocs } from '../state/graphDocs'
import type { GraphStore } from '../state/graphStore'
import { useSelectionStore } from '../state/selectionStore'
import { useToastStore } from '../state/toastStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Popover } from '../ui/Popover'
import { Panel } from './Panel'

/**
 * Zone 4: the Knotwork graph of the active SWF's open graph (UX 4.4): breadcrumb (SWF > layer > graph > node; the graph is a dropdown of the SWF's graphs, the others are links), the event jump
 * list, the canvas, and the AS2 split view (`graph/As2View.tsx`: generated class, selected node's lines highlighted, click a line to select its node). Which graph is open is `state/graphDocs`:
 * the Navigator's Graphs section sets it, and selecting a component that has a graph opens that graph (bridge).
 */
export function GraphPanel() {
  const swf = useActiveSwf()
  const { activeId, store, loaded } = useSwfGraphs()
  const actions = useGraphActions()
  const defs = usePacks()
  const [split, setSplit] = useState(false)
  const [tidied, setTidied] = useState(0) // bumps the canvas to fit the view after a tidy
  const tidy = (): void => {
    if (!store) return
    const s = store.getState()
    // an exec wire leaves an Exec output pin of its source node's definition (a pin of a node from a missing pack, or a dynamic one, counts as data)
    const isExec = (e: (typeof s.edges)[number]): boolean => {
      const src = s.nodes.find((n) => n.id === e.source)
      return defs.get(src?.data.kind ?? '')?.outputs.find((p) => p.name === e.data?.from.pin)?.type === 'Exec'
    }
    s.moveNodes(tidyPositions(s.nodes, s.edges, isExec)) // one update = one undo entry
    setTidied((n) => n + 1)
  }
  return (
    <Panel
      title={strings.graph.title}
      actions={
        <>
          {store && <MakeFunctionBtn store={store} />}
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

/** Turns the selected nodes into a function and puts a Call Function node in their place (`makeFunction`); a refused selection says why. */
function MakeFunctionBtn({ store }: { store: GraphStore }) {
  const swf = useActiveSwf()
  const defs = usePacks()
  const picked = useStore(store, (s) => s.nodes.filter((n) => n.selected).length)
  const run = async (): Promise<void> => {
    if (!swf || !inkwell) return
    const selected = store.getState().nodes.filter((n) => n.selected).map((n) => n.id)
    const n = (useGraphDocs.getState().ids[swf.id] ?? []).length + 1
    const r = await makeFunction({ swf: { id: swf.id, name: swf.name }, store, selected, name: `Function ${n}`, defs }, inkwell)
    useToastStore.getState().push(r.ok ? { tone: 'ok', title: strings.graph.madeFunction } : { tone: 'error', title: strings.graph.makeFunctionFailed, text: r.error })
  }
  return <Btn label={strings.graph.makeFunctionTip} onClick={() => void run()} reason={picked === 0 ? strings.graph.makeFunctionNone : undefined} testId="graph-make-function">{strings.graph.makeFunction}</Btn>
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
  const ids = useGraphDocs((s) => s.ids[swf.id]) ?? [graphId]
  const names = new Map(openGraphs(swf.id).map((g) => [g.id, g.name])) // the open graph's own name is live (`name`); siblings update on the next render
  return (
    <>
      <nav className="breadcrumb" aria-label={strings.graph.breadcrumbLabel}>
        <button type="button" className="row-link" onClick={() => menu && setActiveGraph(swf.id, menu)} disabled={!menu} data-testid="crumb-swf">{swf.name}</button>
        {owner && <><span aria-hidden="true">&gt;</span><button type="button" className="row-link" onClick={() => selectComponent(owner, 'navigator')}>{swf.ir.nodes[owner]?.name}</button></>}
        <span aria-hidden="true">&gt;</span>
        <Popover
          label={strings.graph.pickGraph}
          trigger={(p, open) => (
            <button type="button" className="btn btn-quiet crumb-trigger" {...p} title={strings.graph.pickGraph} aria-label={`${strings.graph.pickGraph}: ${name}`} data-testid="crumb-graph">
              <span className="btn-label">{name}</span>
              <ChevronDown size={13} aria-hidden="true" className={open ? 'flip' : undefined} />
            </button>
          )}
        >
          {(close) => (
            <ul className="menu" role="listbox" aria-label={strings.graph.pickGraph}>
              {ids.map((id) => (
                <li key={id} role="option" aria-selected={id === graphId}>
                  <button type="button" className={id === graphId ? 'is-selected' : undefined} onClick={() => { setActiveGraph(swf.id, id); close() }}>{id === graphId ? name : (names.get(id) ?? id)}</button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
        {nodeTitle && <><span aria-hidden="true">&gt;</span><span>{nodeTitle}</span></>}
      </nav>
      <div className={`graph-body${split ? ' is-split' : ''}`}>
        <GraphCanvas swf={swf} overlay={overlay} store={store} defs={defs} focusNode={focus} fitSignal={tidied} />
        <EventList events={events} selected={selectedNode} onPick={(id) => setFocus({ id, n: (focus?.n ?? 0) + 1 })} />
        {split && (
          <As2View swfName={swf.name} store={store} selectedNode={selectedNode} onPick={(id) => revealNode(graphId, id)} />
        )}
      </div>
    </>
  )
}

/** Floating list of the graph's event nodes over the canvas' top left (filterable, collapsible); a click selects the event and centres the canvas on it. */
function EventList({ events, selected, onPick }: { events: ReturnType<typeof eventNodes>; selected: string | undefined; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(true)
  const [q, setQ] = useState('')
  const label = (ev: (typeof events)[number]): string => (ev.detail ? `${ev.title}: ${ev.detail}` : ev.title)
  const shown = events.filter((ev) => label(ev).toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <aside className="event-list" data-testid="event-list">
      <button type="button" className="event-list-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        <span>{strings.graph.eventsTitle}</span><span className="dim">{events.length}</span>
      </button>
      {open && (
        <>
          <input className="gn-input" placeholder={strings.graph.eventsFilter} aria-label={strings.graph.eventsFilter} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul>
            {shown.map((ev) => (
              <li key={ev.id}><button type="button" className={ev.id === selected ? 'is-selected' : ''} onClick={() => onPick(ev.id)} data-testid={`event-item-${ev.id}`}>{label(ev)}</button></li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}
