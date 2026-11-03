import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Lock, LockOpen, Maximize2, Minimize2, SplitSquareHorizontal, WandSparkles } from 'lucide-react'
import { nodeIndex } from '@nicklaj/knotwork'
import { useStore } from 'zustand'
import { As2View } from '../graph/As2View'
import { GraphCanvas } from '../graph/GraphCanvas'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useLibraryPacks, usePacks } from '../hooks/usePacks'
import { useActiveOverlay, useActiveSwf } from '../hooks/useProject'
import { eventNodes, nodePins } from '../model/graphModel'
import { tidyPositions } from '../model/graphLayout'
import { ownersOfGraph } from '../model/graphNav'
import { menuGraphId, openComponentGraph, openGraphs, openLibraryFunction, setActiveGraph, useGraphDocs } from '../state/graphDocs'
import { useComponentGraphs } from '../state/componentGraphs'
import { useGraphFollow } from '../state/graphFollow'
import { findGraphStore, isReadOnlyGraph, type GraphStore } from '../state/graphStore'
import { useSelectionStore } from '../state/selectionStore'
import { useSettingsStore } from '../state/settingsStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { strings } from '../../shared/strings'
import { VariableStrip } from '../graph/VariableStrip'
import { Btn } from '../ui/Btn'
import { Popover } from '../ui/Popover'
import { Panel } from './Panel'

/**
 * Zone 4: the Knotwork graph of the active SWF's open graph (UX 4.4): breadcrumb (SWF > layer > graph > node; the graph is a dropdown of the SWF's graphs, the others are links), the event jump
 * list, the canvas, and the AS2 split view (`graph/As2View.tsx`: generated class, selected node's lines highlighted, click a line to select its node). Which graph is open is `state/graphDocs`:
 * selecting a layer opens its graph, a blank canvas when it has none (bridge, `state/graphDocs.ts` `openLayerGraph`); the lock button and Ctrl+Click on a layer keep the open one (`state/graphFollow.ts`).
 */
export function GraphPanel() {
  const swf = useActiveSwf()
  const { activeId, store, loaded } = useSwfGraphs()
  const defs = usePacks()
  const locked = useGraphFollow((s) => s.locked)
  const [split, setSplit] = useState(false)
  const full = useWorkspaceStore((s) => s.graphFull)
  const [tidied, setTidied] = useState(0) // bumps the canvas to fit the view after a tidy
  const tidy = (): void => {
    if (!store) return
    const s = store.getState()
    // an exec wire leaves an Exec output pin of its source node, dynamic ones included (a Call Function exit); a pin of a node from a missing pack counts as data
    const byId = new Map(s.nodes.map((n) => [n.id, n]))
    const isExec = (e: (typeof s.edges)[number]): boolean => {
      const src = byId.get(e.source)
      return (src && nodePins(defs, src, s.variables, s.signature)?.outputs.find((p) => p.name === e.data?.from.pin)?.type) === 'Exec'
    }
    // two or more selected nodes: tidy only those (they keep their top-left corner and only the wires between them count); otherwise the whole graph
    const picked = s.nodes.filter((n) => n.selected)
    const subset = picked.length > 1
    const ids = new Set(picked.map((n) => n.id))
    const nodes = subset ? picked : s.nodes
    const edges = subset ? s.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) : s.edges
    s.moveNodes(tidyPositions(nodes, edges, isExec, { hang: useSettingsStore.getState().tidyHang })) // one update = one undo entry
    if (!subset) setTidied((n) => n + 1) // fit the view only after a whole-graph tidy
  }
  return (
    <Panel
      title={strings.graph.title}
      actions={
        <>
          <Btn icon={locked ? Lock : LockOpen} pressed={locked} label={locked ? strings.graph.unlock : strings.graph.lock} onClick={() => useGraphFollow.getState().setLocked(!locked)} testId="graph-lock" />
          <Btn icon={WandSparkles} label={strings.graph.tidy} onClick={tidy} reason={store ? undefined : strings.nav.noSwf} testId="graph-tidy" />
          <Btn icon={full ? Minimize2 : Maximize2} pressed={full} label={full ? strings.graph.fullscreenExit : strings.graph.fullscreen} onClick={() => useWorkspaceStore.getState().setGraphFull(!full)} testId="graph-fullscreen" />
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
          </div>
        ) : (
          <OpenGraph key={`${swf.id}/${activeId}`} store={store} graphId={activeId} split={split} tidied={tidied} />
        )}
      </div>
    </Panel>
  )
}

let refocusBody = false

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
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (refocusBody) bodyRef.current?.focus()
    refocusBody = false
  }, [])
  // a Lint row, trace line or AS2 line pointed at a node of this graph: select it and centre the canvas on it
  useEffect(() => {
    if (reveal && reveal.graph === graphId && nodeIndex(store.getState().nodes).has(reveal.node)) setFocus({ id: reveal.node, n: reveal.n })
  }, [reveal, graphId, store])
  const events = useMemo(() => eventNodes(defs, nodes), [defs, nodes])
  const owner = ownersOfGraph(overlay, graphId).find((id) => id !== swf.ir.root && swf.ir.nodes[id])
  const node = selectedNode ? nodeIndex(nodes).get(selectedNode) : undefined
  const nodeTitle = node ? (defs.get(node.data.kind)?.title ?? node.data.kind) : undefined
  const menu = menuGraphId(swf.id)
  const allIds = useGraphDocs((s) => s.ids[swf.id]) ?? [graphId]
  const names = new Map(openGraphs(swf.id).map((g) => [g.id, g.name])) // the open graph's own name is live (`name`); siblings update on the next render
  // the dropdown lists graphs of the same kind: from a graph, the SWF's graphs; from a function, the functions that can be edited (the SWF's and those of local packs)
  const isFunction = useStore(store, (s) => s.meta.scope === 'function')
  const isComponent = useStore(store, (s) => s.meta.scope === 'blueprint')
  const componentGraphs = useComponentGraphs((s) => s.graphs)
  const localPacks = useLibraryPacks().filter((p) => p.origin === 'library')
  const choices: { id: string; label: string; pick(): void }[] = isComponent
    ? Object.values(componentGraphs).map((g) => ({ id: g.id, label: g.id === graphId ? name : g.name, pick: () => openComponentGraph({ id: swf.id, name: swf.name }, g) }))
    : isFunction
    ? [
        ...allIds.filter((id) => findGraphStore(swf.id, id)?.getState().meta.scope === 'function').map((id) => ({ id, label: id === graphId ? name : (names.get(id) ?? id), pick: () => setActiveGraph(swf.id, id) })),
        ...localPacks.flatMap((p) => p.functions.map((fn) => ({ id: fn.id, label: `${fn.id === graphId ? name : fn.name} (${p.id})`, pick: () => openLibraryFunction({ id: swf.id, name: swf.name }, fn) })))
      ]
    : allIds.filter((id) => findGraphStore(swf.id, id)?.getState().meta.scope !== 'function').map((id) => ({ id, label: id === graphId ? name : (names.get(id) ?? id), pick: () => setActiveGraph(swf.id, id) }))
  return (
    <>
      <nav className="breadcrumb" aria-label={strings.graph.breadcrumbLabel}>
        <button type="button" className="row-link" onClick={() => menu && setActiveGraph(swf.id, menu)} disabled={!menu} data-testid="crumb-swf">{swf.name}</button>
        {owner && <><span aria-hidden="true">&gt;</span><button type="button" className="row-link" onClick={() => selectComponent(owner, 'navigator')}>{swf.ir.nodes[owner]?.name}</button></>}
        <span aria-hidden="true">&gt;</span>
        <Popover
          label={strings.graph.pickGraph}
          className="crumb-pop"
          trigger={(p, open) => (
            <button type="button" className="btn btn-quiet crumb-trigger" {...p} title={strings.graph.pickGraph} aria-label={`${strings.graph.pickGraph}: ${name}`} data-testid="crumb-graph">
              <span className="btn-label">{name}</span>
              <ChevronDown size={13} aria-hidden="true" className={open ? 'flip' : undefined} />
            </button>
          )}
        >
          {(close) => (
            <ul className="menu" role="listbox" aria-label={strings.graph.pickGraph}>
              {choices.map((c) => (
                <li key={c.id} role="option" aria-selected={c.id === graphId}>
                  <button type="button" className={c.id === graphId ? 'is-selected' : undefined} onClick={() => { c.pick(); close() }}>{c.label}</button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
        {nodeTitle && <><span aria-hidden="true">&gt;</span><span>{nodeTitle}</span></>}
      </nav>
      <VariableStrip swfId={swf.id} store={store} />
      {isReadOnlyGraph(store) && <p className="dim settings-sub" role="status" data-testid="graph-readonly">{strings.graph.readOnly}</p>}
      <div
        ref={bodyRef}
        tabIndex={-1}
        style={{ outline: 'none' }}
        className={`graph-body${split ? ' is-split' : ''}`}
        onKeyDown={(e) => {
          // Tab / Shift+Tab step through the breadcrumb's graph list; typing fields keep Tab
          const t = e.target as HTMLElement
          if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || t.closest('input, textarea, select, [contenteditable="true"]') || choices.length < 2) return
          e.preventDefault()
          refocusBody = true // the switch remounts this graph and drops focus; the next one takes it back
          const i =choices.findIndex((c) => c.id === graphId)
          choices[(i + (e.shiftKey ? choices.length - 1 : 1)) % choices.length]?.pick()
        }}
      >
        <GraphCanvas swf={swf} overlay={overlay} store={store} defs={defs} focusNode={focus} fitSignal={tidied} />
        {nodes.length === 0 && <p className="graph-blank-hint" data-testid="graph-blank-hint">{strings.graph.blankHint}</p>}
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
