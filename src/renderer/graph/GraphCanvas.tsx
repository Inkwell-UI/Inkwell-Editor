import {
  applyEdgeChanges, applyNodeChanges, Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, useViewport,
  type Connection, type EdgeChange, type NodeChange, type OnConnectEnd
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  createClipboard, FindBar, HaloEdge, isTyping, nodeIndex, NAVIGATION_PROPS, SpawnMenu, useSpaceMenu, useWheelNavigation, type SpawnOption
} from '@nicklaj/knotwork'
import type { NodeDef as KwDef } from '@nicklaj/knotwork'
import '@nicklaj/knotwork/knotwork.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { NodeDef } from '@inkwell-ui/spec'
import type { SwfDoc } from '../../shared/projectState'
import { categoriesOf, categoryVar, connectionRule, layerOptions, nodePins, nodeTarget, PIN_STYLE, spawnDefs, spawnFor, spawnWire, type SpawnFromPin } from '../model/graphModel'
import { newEdge, NODE_TYPE, pinName, type FlowEdge, type FlowNode, type GraphStore } from '../state/graphStore'
import { createGraphValidation } from '../state/graphValidation'
import { openGraphs } from '../state/graphDocs'
import { graphEditorBlurred } from '../state/hotReload'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../strings'
import { GraphContext, InkwellNode, type GraphCtx } from './NodeView'
import './graph.css'

const nodeTypes = { [NODE_TYPE]: InkwellNode }
const edgeTypes = { default: HaloEdge }

interface MenuState {
  x: number
  y: number
  /** Client position the node is created at, in flow space after conversion. */
  from: SpawnFromPin | null
}

/**
 * The Knotwork/React Flow canvas of one graph. Everything it shows comes from the graph store (nodes, edges, variables), the pack definitions and
 * the live validation; it writes back only through the store's actions, so every edit is one undo entry of the SWF (drags via beginDrag/endDrag,
 * typing coalesced per word). Mounts only visible nodes (`NAVIGATION_PROPS.onlyRenderVisibleElements`) and never scans the node or edge arrays per node
 * (Knotwork's indexes).
 */
export function GraphCanvas(props: { swf: SwfDoc; overlay: SwfDoc['overlay'] | undefined; store: GraphStore; defs: ReadonlyMap<string, NodeDef>; focusNode?: { id: string; n: number } | undefined; fitSignal?: number }) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

function Canvas({ swf, overlay, store, defs, focusNode, fitSignal }: Parameters<typeof GraphCanvas>[0]) {
  const nodes = useStore(store, (s) => s.nodes)
  const edges = useStore(store, (s) => s.edges)
  const variables = useStore(store, (s) => s.variables)
  const picked = useStore(store, (s) => s.nodes.filter((n) => n.selected).length)
  const wires = useStore(store, (s) => s.edges.filter((e) => e.selected).length)
  const keysRef = useRef<HTMLDivElement>(null)
  const [keysBacked, setKeysBacked] = useState(false)
  const view = useViewport()
  const wrap = useRef<HTMLDivElement>(null)
  const rf = useReactFlow()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [find, setFind] = useState(false)
  const layers = useMemo(() => layerOptions(swf.ir, overlay), [swf.ir, overlay])
  const rule = useMemo(() => connectionRule(defs, () => store.getState().variables), [defs, store])
  const sdefs = useMemo(() => spawnDefs(defs), [defs])
  const categories = useMemo(() => categoriesOf(defs), [defs])

  // live validation: badges on nodes, from the same function main runs for the Lint dock
  const validation = useMemo(
    () =>
      createGraphValidation(store, () => ({
        defs,
        layers: new Set(Object.keys(swf.ir.nodes)),
        siblings: openGraphs(swf.id),
        target: swf.ir.target.kind
      })),
    [store, defs, swf.ir, swf.id]
  )
  useEffect(() => validation.start(), [validation])

  const ctx = useMemo<GraphCtx>(() => ({ store, defs, layers, variables, issues: validation.use }), [store, defs, layers, variables, validation])

  const clipboard = useMemo(
    () => createClipboard<FlowNode, ReturnType<GraphStore['getState']>>({ store, edge: (s, sh, t, th) => newEdge({ node: s, pin: pinName(sh) }, { node: t, pin: pinName(th) }) as FlowEdge }),
    [store]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const moves: Record<string, { x: number; y: number }> = {}
      const rest: NodeChange<FlowNode>[] = []
      for (const c of changes) {
        if (c.type === 'position' && c.position) moves[c.id] = c.position
        else if (c.type !== 'remove') rest.push(c)
      }
      if (Object.keys(moves).length) store.getState().moveNodes(moves)
      if (rest.length) store.setState({ nodes: applyNodeChanges(rest, store.getState().nodes) })
    },
    [store]
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      const rest = changes.filter((c) => c.type === 'select')
      if (rest.length) store.setState({ edges: applyEdgeChanges(rest, store.getState().edges) })
    },
    [store]
  )

  const isValidConnection = useCallback((c: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => {
    const s = store.getState()
    return rule(s.nodes, s.edges, c) === null
  }, [rule, store])
  const onConnect = useCallback(
    (c: Connection) => {
      const s = store.getState()
      if (rule(s.nodes, s.edges, c) === null) s.connect({ node: c.source, pin: pinName(c.sourceHandle) }, { node: c.target, pin: pinName(c.targetHandle) })
    },
    [rule, store]
  )
  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    if (state.isValid || state.toNode || !state.fromNode || !state.fromHandle) return
    const e = event as MouseEvent
    setMenu({ x: e.clientX, y: e.clientY, from: { nodeId: state.fromNode.id, handle: state.fromHandle.id ?? '', type: state.fromHandle.type } })
  }, [])

  // the pane is not focusable by itself; keys (Ctrl+F, copy...) need the canvas to hold focus after a click on empty space
  const focusCanvas = (e: React.PointerEvent): void => {
    if (!(e.target as HTMLElement).closest('input, select, textarea, button')) wrap.current?.focus({ preventScroll: true })
  }
  // Space listens on the window: only open when the pointer is over this canvas
  const space = useSpaceMenu(wrap, (p) => wrap.current?.matches(':hover') && setMenu({ ...p, from: null }))

  const options = useMemo(() => (menu ? spawnFor({ defs, spawn: sdefs, nodes: store.getState().nodes, edges: store.getState().edges, vars: store.getState().variables, from: menu.from }) : []), [menu, defs, sdefs, store])
  const pick = (o: SpawnOption<KwDef>): void => {
    if (!menu) return
    const id = crypto.randomUUID()
    const pos = rf.screenToFlowPosition({ x: menu.x, y: menu.y })
    const wire = spawnWire(menu.from, id, o)
    store.getState().addNode({ id, kind: o.def.kind, pos }, wire)
    store.getState().setSelection([id])
    setMenu(null)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const native = e.nativeEvent
    if (isTyping(native)) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'f') return void (e.preventDefault(), setFind(true))
    if (mod && k === 'c') return void (e.preventDefault(), clipboard.copy())
    if (mod && k === 'v') return void (e.preventDefault(), clipboard.paste())
    if (mod && k === 'a') return void (e.preventDefault(), store.getState().setSelection(store.getState().nodes.map((n) => n.id)))
    if (!mod && !e.altKey && k === 'f') {
      const sel = store.getState().nodes.filter((n) => n.selected).map((n) => ({ id: n.id }))
      return void (e.preventDefault(), rf.fitView({ ...(sel.length ? { nodes: sel } : {}), duration: 250, padding: 0.3, maxZoom: 1.2 }))
    }
    if (mod && k === 'd') return void (e.preventDefault(), clipboard.duplicate())
  }

  // wire look: Exec wires are thick, white and dashed-free; data wires thin and coloured by the type they carry
  const styledEdges = useMemo(() => {
    const index = nodeIndex(nodes)
    return edges.map((e) => {
      const n = index.get(e.source)
      const pin = n && nodePins(defs, n, variables)?.outputs.find((p) => p.name === pinName(e.sourceHandle))
      const exec = pin ? pin.type === 'Exec' : false
      const color = pin ? PIN_STYLE[pin.type].color : 'var(--fg-faint)'
      return { ...e, className: exec ? 'gw-exec' : 'gw-data', style: { stroke: color, strokeWidth: exec ? 3 : 1.5 } }
    })
  }, [nodes, edges, defs, variables])

  const select = useSelectionStore((s) => s.selectGraphNode)
  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: FlowNode[] }) => {
      const one = sel.length === 1 ? sel[0] : undefined
      if (one) select(one.id, nodeTarget(defs.get(one.data.kind), one), String(store.getState().meta["id"]))
    },
    [defs, select, store]
  )

  // jump to a node (event list, Find): select it and centre on it
  const focused = useRef(false)
  useEffect(() => {
    if (!focusNode) return
    focused.current = true
    store.getState().setSelection([focusNode.id])
    void rf.fitView({ nodes: [{ id: focusNode.id }], duration: 250, maxZoom: 1.2, padding: 0.4 })
  }, [focusNode, rf, store])

  // fit once the nodes have been measured (the first fit runs before their inline fields have their final size)
  useEffect(() => {
    const t = setTimeout(() => !focused.current && void rf.fitView({ padding: 0.15, maxZoom: 1 }), 250)
    return () => clearTimeout(t)
  }, [rf])

  // Tidy Layout moved everything: show the result
  useEffect(() => {
    if (fitSignal) void rf.fitView({ padding: 0.15, maxZoom: 1, duration: 250 })
  }, [fitSignal, rf])

  // the hints get a dark backing only while a mounted node sits under them
  useLayoutEffect(() => {
    const box = keysRef.current?.getBoundingClientRect()
    if (!box) return
    setKeysBacked([...(wrap.current?.querySelectorAll('.react-flow__node') ?? [])].some((el) => {
      const r = el.getBoundingClientRect()
      return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top
    }))
  }, [view.x, view.y, view.zoom, nodes, picked, wires])

  useWheelNavigation(wrap)
  const hasNodes = nodes.length > 0

  return (
    <GraphContext.Provider value={ctx}>
      <div className="graph-flow" ref={wrap} tabIndex={0} onKeyDown={onKeyDown} onPointerDownCapture={focusCanvas} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && graphEditorBlurred()} data-testid="graph-canvas">
        <ReactFlow<FlowNode, FlowEdge>
          {...NAVIGATION_PROPS}
          nodes={nodes}
          edges={styledEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          onNodeDragStart={() => store.getState().beginDrag()}
          onNodeDragStop={() => store.getState().endDrag()}
          onDelete={({ nodes: n, edges: ed }) => store.getState().deleteSelection(n.map((x) => x.id), ed.map((x) => x.id))}
          onSelectionChange={onSelectionChange}
          onMoveStart={space.cancel}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable style={{ width: 140, height: 90 }} className="graph-minimap" nodeColor="var(--fg-faint)" maskColor="rgba(255, 255, 255, 0.18)" />
        </ReactFlow>
        {!hasNodes && <div className="graph-hint"><p className="empty">{strings.graph.emptyCanvas}</p></div>}
        <div className={`graph-keys${keysBacked ? ' is-backed' : ''}`} ref={keysRef} data-testid="graph-keys">
          {strings.graph.keyGroups(picked, wires).map((g, i) => (
            <div key={i} className="graph-keys-group">
              {g.map(([label, key]) => <div key={label} className="graph-key"><span>{label}</span><kbd>{key}</kbd></div>)}
            </div>
          ))}
        </div>
        {find && (
          <FindBar<FlowNode>
            nodes={nodes}
            titleOf={(n) => defs.get(n.data.kind)?.title ?? n.data.kind}
            valuesOf={(n) => n.data.fields}
            accent={(n) => categoryVar(defs.get(n.data.kind)?.category ?? '')}
            onPick={(id) => store.getState().setSelection([id])}
            onClose={() => (setFind(false), wrap.current?.focus())}
          />
        )}
        {menu && (
          <SpawnMenu<KwDef>
            x={menu.x}
            y={menu.y}
            title={menu.from ? strings.graph.spawnFromPin : strings.graph.spawnTitle}
            options={options}
            categories={categories}
            accent={(d) => categoryVar(d.category)}
            onPick={pick}
            onClose={() => (setMenu(null), wrap.current?.focus())}
          />
        )}
      </div>
    </GraphContext.Provider>
  )
}
