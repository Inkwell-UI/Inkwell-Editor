import { createHistory } from '@nicklaj/knotwork'
import type { Edge, Node } from '@xyflow/react'
import { temporal } from 'zundo'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { Graph, GraphNode } from '@inkwell-ui/spec'
import { applySignature, callFields, refreshCall, refreshCalls, staleCalls } from '../../shared/functions'
import { registerHistory, unregisterHistory } from './swfHistory'

/**
 * Graph state per graph, in React Flow's shape (nodes, edges) so Knotwork's history, rules and indexes apply unchanged. A graph file keeps unknown
 * keys at every level (`extra`, loose objects): `data` holds the whole file node and `data` of an edge the whole file edge, and `toGraph` writes them
 * back with only the editable parts replaced. Nodes of packs that are not installed are ordinary nodes here: nothing is dropped.
 *
 * - One zundo history per graph via Knotwork's `createHistory` (typing in a field coalesces per word, `beginDrag`/`endDrag` make a drag one entry,
 *   selection is not recorded). All of a SWF's histories (graphs and overlay) are ordered into the SWF's one history by swfHistory.ts.
 * - Every real change is saved through the saver set by `setGraphSaver` (IPC `saveGraph`), debounced; `flushGraphSaves()` writes pending ones now.
 * - Handle ids are `<pin>-in` / `<pin>-out` (Knotwork's pin grammar; pack pin names contain no `-` or `:`).
 */
export type GraphNodeData = GraphNode & Record<string, unknown>
export type GraphEdgeData = Graph['edges'][number] & Record<string, unknown>
export type FlowNode = Node<GraphNodeData>
export type FlowEdge = Edge<GraphEdgeData>
type Variable = Graph['variables'][number]

/** The one React Flow node type: the kind lives in `data.kind`, so unknown pack kinds render through the same component. */
export const NODE_TYPE = 'inkwell'
export const inHandle = (pin: string): string => `${pin}-in`
export const outHandle = (pin: string): string => `${pin}-out`
const pinOf = (h: string | null | undefined): string => (h ?? '').replace(/-(in|out)$/, '')
const edgeId = (from: { node: string; pin: string }, to: { node: string; pin: string }): string => `${from.node}.${from.pin}->${to.node}.${to.pin}`

/** A wire in React Flow shape (also the clipboard's wire factory). */
export const newEdge = (from: { node: string; pin: string }, to: { node: string; pin: string }): FlowEdge => ({
  id: edgeId(from, to), source: from.node, target: to.node, sourceHandle: outHandle(from.pin), targetHandle: inHandle(to.pin), data: { from, to } as GraphEdgeData
})
/** The pin name of a handle id (`then-out` -> `then`). */
export const pinName = pinOf

const withField = (fields: Record<string, unknown>, field: string, value: unknown): Record<string, unknown> => {
  const { [field]: _old, ...rest } = fields
  return value === undefined ? rest : { ...rest, [field]: value }
}

interface Doc {
  name: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  variables: Graph['variables']
  comments: Graph['comments']
  groups: Graph['groups']
  /** A function graph's interface (docs/functions.md); part of the document so a change is one undo entry. Undefined for every other graph. */
  signature: Graph['signature']
  /** A component graph's props (its data inputs); part of the document so a change is one undo entry. Undefined for every other graph. */
  props: Graph['props']
}
export interface GraphState extends Doc {
  /** specVersion, id, scope and every unknown top-level key of the file. */
  meta: Omit<Graph, keyof Doc | 'nodes' | 'edges'>
  rename(name: string): void
  /** `wire` connects the new node in the same update (one history entry), as a dropped wire does. */
  addNode(n: { id: string; kind: string; pos: { x: number; y: number }; fields?: Record<string, unknown> }, wire?: { from: { node: string; pin: string }; to: { node: string; pin: string } }): void
  /** Deletes nodes (with their wires) and wires in one history entry. */
  deleteSelection(nodeIds: string[], edgeIds: string[]): void
  removeNodes(ids: string[]): void
  /** Sets one field (`undefined` removes it); typing in the same field joins the current word's history entry. */
  setField(nodeId: string, field: string, value: unknown): void
  moveNodes(positions: Record<string, { x: number; y: number }>): void
  connect(from: { node: string; pin: string }, to: { node: string; pin: string }): void
  disconnect(edgeId: string): void
  setSelection(ids: string[]): void
  /** The scope of a variable is the graph's scope (menu graph: menu variables; component graph: component variables) unless given: `saved` (S5) goes to the menu graph. */
  addVariable(v: Pick<Variable, 'id' | 'name' | 'type'> & { default?: unknown; scope?: Variable['scope'] }): void
  updateVariable(id: string, patch: Partial<Pick<Variable, 'name' | 'type' | 'default'>>): void
  removeVariable(id: string): void
  /** Function graphs: gives the function a new signature; the wires of its Function Entry / Exit nodes follow their pin by id. Callers follow through the store listener. */
  setSignature(next: NonNullable<Graph['signature']>): void
  /** Component graphs: replaces the props. */
  setProps(next: NonNullable<Graph['props']>): void
  /** Get Prop: reads the prop `propId` (the node also keeps a copy of its type, which gives its output pin the type). */
  setNodeProp(nodeId: string, propId: string): void
  /** Call Function: points the node at `fn` (copies its signature; wires of pins that no longer exist are dropped). */
  setCallTarget(nodeId: string, fn: Graph): void
  /** Refreshes every Call Function node that calls `fn` and holds an out-of-date copy of its signature. */
  syncCalls(fn: Graph): void
  /** Every Call Function of `from` now calls `to` (a function moved into a pack; the signature is the same). */
  retargetCalls(from: string, to: string): void
  /** Replaces the nodes, wires and groups with those of `g` (Make function: the selection became a call). One undo entry. */
  applyGraph(g: Graph): void
  beginDrag(): void
  endDrag(): void
}
export type GraphStore = UseBoundStore<StoreApi<GraphState>> & { temporal: StoreApi<import('zundo').TemporalState<Doc>> }

export function toFlow(g: Graph): Doc & { meta: GraphState['meta'] } {
  const { nodes, edges, variables, comments, groups, name, signature, props, ...meta } = g
  return {
    meta,
    name,
    variables,
    comments,
    groups,
    signature,
    props,
    nodes: nodes.map((n) => ({ id: n.id, type: NODE_TYPE, position: { x: n.pos.x, y: n.pos.y }, data: n as GraphNodeData })),
    edges: edges.map((e) => ({ id: edgeId(e.from, e.to), source: e.from.node, target: e.to.node, sourceHandle: outHandle(e.from.pin), targetHandle: inHandle(e.to.pin), data: e as GraphEdgeData }))
  }
}

export function toGraph(s: Pick<GraphState, keyof Doc | 'meta'>): Graph {
  return {
    ...s.meta,
    name: s.name,
    nodes: s.nodes.map((n) => ({ ...n.data, id: n.id, pos: { ...n.data.pos, x: n.position.x, y: n.position.y } })),
    edges: s.edges.map((e) => ({ ...e.data, from: { ...e.data!.from, node: e.source, pin: pinOf(e.sourceHandle) }, to: { ...e.data!.to, node: e.target, pin: pinOf(e.targetHandle) } })),
    variables: s.variables,
    comments: s.comments,
    groups: s.groups,
    ...(s.signature ? { signature: s.signature } : {}),
    ...(s.props ? { props: s.props } : {})
  } as Graph
}

/** The state with the nodes' data and the wires of `g`; existing React Flow nodes keep their selection and measured size. */
function withNodeData(s: Pick<GraphState, 'nodes'>, g: Graph): Pick<GraphState, 'nodes' | 'edges'> {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  return {
    nodes: s.nodes.map((n) => {
      const next = byId.get(n.id)
      return next && next.fields !== (n.data as GraphNode).fields ? { ...n, data: { ...n.data, ...next } as GraphNodeData } : n
    }),
    edges: toFlow(g).edges
  }
}

/** What a history entry compares: everything the file holds except selection and measured sizes. */
const docKey = (p: Doc): string =>
  JSON.stringify([p.name, p.nodes.map((n) => [n.id, n.position, n.data]), p.edges.map((e) => [e.id, e.source, e.target, e.sourceHandle, e.targetHandle, e.data]), p.variables, p.comments, p.groups, p.signature, p.props])

interface Entry {
  swfName: string
  store: GraphStore
  timer?: ReturnType<typeof setTimeout>
}
const stores = new Map<string, Entry>() // `${swfId}/${graphId}`
let saver: ((swfName: string, graph: Graph) => void) | undefined
export const setGraphSaver = (fn: typeof saver): void => void (saver = fn)
let onEdit: (() => void) | undefined
/** Called after every real change of any graph (not selection or measuring). */
export const setGraphEditListener = (fn: typeof onEdit): void => void (onEdit = fn)
const SAVE_DELAY = 300

function save(e: Entry): void {
  clearTimeout(e.timer)
  delete e.timer
  saver?.(e.swfName, toGraph(e.store.getState()))
}
/** Writes every graph whose last change is still waiting for its debounce (call before closing a project or switching SWF). */
export const flushGraphSaves = (): void => stores.forEach((e) => e.timer && save(e))

export function getGraphStore(swfId: string, swfName: string, initial: Graph): GraphStore {
  const key = `${swfId}/${initial.id}`
  const hit = stores.get(key)
  if (hit) {
    hit.swfName = swfName
    return hit.store
  }
  const history = createHistory<GraphState, Doc>({
    partialize: (s) => ({ name: s.name, nodes: s.nodes, edges: s.edges, variables: s.variables, comments: s.comments, groups: s.groups, signature: s.signature, props: s.props }),
    key: docKey,
    slices: (s) => [s.nodes, s.edges, s.variables, s.name, s.signature, s.props]
  })
  const store = create<GraphState>()(
    temporal(
      (set, get) => ({
        ...toFlow(initial),
        rename: (name) => history.edit('name', name, get, () => set({ name })),
        addNode: (n, wire) =>
          set((s) => ({
            nodes: [...s.nodes, { id: n.id, type: NODE_TYPE, position: n.pos, data: { id: n.id, kind: n.kind, fields: n.fields ?? {}, pos: { ...n.pos } } as GraphNodeData }],
            ...(wire ? { edges: [...s.edges, newEdge(wire.from, wire.to)] } : {})
          })),
        deleteSelection: (nodeIds, edgeIds) => {
          const gone = new Set(nodeIds)
          const cut = new Set(edgeIds)
          set((s) => ({
            nodes: s.nodes.filter((n) => !gone.has(n.id)),
            edges: s.edges.filter((e) => !cut.has(e.id) && !gone.has(e.source) && !gone.has(e.target)),
            groups: s.groups.map((g) => (g.nodes.some((id) => gone.has(id)) ? { ...g, nodes: g.nodes.filter((id) => !gone.has(id)) } : g))
          }))
        },
        removeNodes: (ids) => {
          const gone = new Set(ids)
          set((s) => ({
            nodes: s.nodes.filter((n) => !gone.has(n.id)),
            edges: s.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
            groups: s.groups.map((g) => (g.nodes.some((id) => gone.has(id)) ? { ...g, nodes: g.nodes.filter((id) => !gone.has(id)) } : g))
          }))
        },
        setField: (nodeId, field, value) =>
          history.edit(`${nodeId}:${field}`, value, get, () =>
            set((s) => ({ nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, fields: withField(n.data.fields, field, value) } } : n)) }))
          ),
        moveNodes: (pos) => set((s) => ({ nodes: s.nodes.map((n) => (pos[n.id] ? { ...n, position: pos[n.id]! } : n)) })),
        connect: (from, to) =>
          set((s) => {
            const id = edgeId(from, to)
            return s.edges.some((e) => e.id === id) ? s : { edges: [...s.edges, newEdge(from, to)] }
          }),
        disconnect: (id) => set((s) => ({ edges: s.edges.filter((e) => e.id !== id) })),
        setSelection: (ids) => {
          const on = new Set(ids)
          set((s) => ({ nodes: s.nodes.map((n) => (!!n.selected === on.has(n.id) ? n : { ...n, selected: on.has(n.id) }) ) }))
        },
        addVariable: (v) => set((s) => ({ variables: [...s.variables, { ...v, scope: v.scope ?? s.meta.scope } as Variable] })),
        updateVariable: (id, patch) =>
          history.edit(`var:${id}`, patch.name ?? patch.default, get, () => set((s) => ({ variables: s.variables.map((v) => (v.id === id ? ({ ...v, ...patch } as Variable) : v)) }))),
        removeVariable: (id) => set((s) => ({ variables: s.variables.filter((v) => v.id !== id) })),
        setSignature: (next) =>
          set((s) => {
            const g = applySignature(toGraph(s), next)
            return { signature: next, edges: toFlow(g).edges }
          }),
        setProps: (next) =>
          set((s) => ({
            props: next,
            // every Get Prop node keeps the type of its prop up to date
            nodes: s.nodes.map((n) => {
              const f = n.data.fields
              const p = n.data.kind.startsWith('core/GetProp@') ? next.find((x) => x.id === f['prop']) : undefined
              return p && (f['propType'] !== p.type || f['propName'] !== p.name) ? { ...n, data: { ...n.data, fields: { ...f, propType: p.type, propName: p.name } } } : n
            })
          })),
        setNodeProp: (nodeId, propId) =>
          set((s) => {
            const p = s.props?.find((x) => x.id === propId)
            return { nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, fields: { ...n.data.fields, prop: propId, ...(p ? { propType: p.type, propName: p.name } : {}) } } } : n)) }
          }),
        setCallTarget: (nodeId, fn) =>
          set((s) => {
            const g = toGraph(s)
            // the new function's pins have other ids, so the wires of the old call's pins are dropped by the refresh; the node keeps its place and id
            const moved = { ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, fields: { ...n.fields, function: fn.id } } : n)) }
            const next = refreshCall(moved, nodeId, fn)
            return withNodeData(s, next)
          }),
        syncCalls: (fn) =>
          set((s) => {
            const g = toGraph(s)
            if (staleCalls(g, fn).length === 0) return s
            return withNodeData(s, refreshCalls(g, fn))
          }),
        retargetCalls: (from, to) =>
          set((s) => {
            const g = toGraph(s)
            const hit = (n: Graph['nodes'][number]): boolean => n.kind.split('/')[1]?.startsWith('CallFunction@') === true && n.fields['function'] === from
            if (!g.nodes.some(hit)) return s
            return withNodeData(s, { ...g, nodes: g.nodes.map((n) => (hit(n) ? { ...n, fields: { ...n.fields, function: to } } : n)) })
          }),
        applyGraph: (g) => set((s) => ({ ...toFlow(g), meta: s.meta, nodes: toFlow(g).nodes })),
        beginDrag: () => history.beginDrag(store),
        endDrag: () => history.endDrag(store)
      }),
      { ...history.options, limit: 100 }
    )
  ) as unknown as GraphStore
  const entry: Entry = { swfName, store }
  stores.set(key, entry)
  registerHistory(swfId, `graph:${initial.id}`, store.temporal)
  store.subscribe((s, prev) => {
    if (s.signature !== prev.signature && s.meta.scope === 'function') syncCallers(swfId, initial.id, toGraph(s))
    if (docKey(s) === docKey(prev)) return // selection and measuring are not edits
    onEdit?.()
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => save(entry), SAVE_DELAY)
  })
  return store
}

/**
 * A function's signature changed (an edit, an undo or a redo): every other graph of the SWF refreshes its calls of it. Not recorded in their histories: the calls are derived from the
 * signature, so undoing the signature change brings them back by itself, and an extra entry here would break the SWF's undo order.
 */
function syncCallers(swfId: string, fnId: string, fn: Graph): void {
  for (const [key, e] of stores) {
    if (!key.startsWith(`${swfId}/`) || key === `${swfId}/${fnId}`) continue
    const t = e.store.temporal.getState()
    t.pause()
    try {
      e.store.getState().syncCalls(fn)
    } finally {
      t.resume()
    }
  }
}

/** A function of the SWF moved into a pack: every graph of the SWF calls it by its new id. Not recorded in the histories (the file move is not undoable either). */
export function retargetCalls(swfId: string, from: string, to: string): void {
  for (const [key, e] of stores) {
    if (!key.startsWith(`${swfId}/`)) continue
    const t = e.store.temporal.getState()
    t.pause()
    try {
      e.store.getState().retargetCalls(from, to)
    } finally {
      t.resume()
    }
  }
}

/** Library functions of the loaded packs by `<packId>/<functionId>` (the graph's id is that qualified id). Set when the pack set arrives (`hooks/usePacks`). */
let library: ReadonlyMap<string, Graph> = new Map()
export const getLibraryFunctions = (): ReadonlyMap<string, Graph> => library
/** New pack set: every call to a library function whose copy of the signature is out of date is refreshed, in every open graph of every SWF (derived data, not recorded in the histories). */
export function setLibraryFunctions(next: ReadonlyMap<string, Graph>): void {
  library = next
  for (const e of stores.values()) {
    const t = e.store.temporal.getState()
    t.pause()
    try {
      for (const fn of next.values()) e.store.getState().syncCalls(fn)
    } finally {
      t.resume()
    }
  }
}

/** The function graphs a Call Function node of `store` can call: the SWF's own (a library function that is open for editing is not one of them) and the libraries'. */
export function functionGraphs(store: GraphStore): Graph[] {
  const swfId = [...stores].find(([, e]) => e.store === store)?.[0].split('/')[0]
  if (swfId === undefined) return []
  const own = [...stores].flatMap(([key, e]) => (key.startsWith(`${swfId}/`) && e.store.getState().meta.scope === 'function' && !key.slice(swfId.length + 1).includes('/') ? [toGraph(e.store.getState())] : []))
  return [...own, ...library.values()]
}

/** `functionGraphs` as picker entries: a library function shows its pack after the name. */
export const functionChoices = (store: GraphStore): { id: string; name: string }[] =>
  functionGraphs(store).map((g) => ({ id: g.id, name: g.id.includes('/') ? `${g.name} (${g.id.split('/')[0]})` : g.name }))

/** Points a Call Function node of `store` at the function graph `fnId` of the same SWF. */
export function pointCall(store: GraphStore, nodeId: string, fnId: string): void {
  const fn = functionGraphs(store).find((g) => g.id === fnId)
  if (fn) store.getState().setCallTarget(nodeId, fn)
}

/** Writes a graph's file now (a graph created from a selection has content the file does not have yet). */
export function saveGraphNow(swfId: string, graphId: string): void {
  const e = stores.get(`${swfId}/${graphId}`)
  if (e) save(e)
}

/** The open store of a graph, if it was loaded. */
export const findGraphStore = (swfId: string, graphId: string): GraphStore | undefined => stores.get(`${swfId}/${graphId}`)?.store

/** Forgets a deleted graph: no more saves (a late one would bring the file back) and no more undo entries for it. */
export function dropGraphStore(swfId: string, graphId: string): void {
  const key = `${swfId}/${graphId}`
  clearTimeout(stores.get(key)?.timer)
  stores.delete(key)
  unregisterHistory(swfId, `graph:${graphId}`)
}

/** Drops every graph store (another project opened); pending saves are dropped with them, so flush first if they matter. */
export function resetGraphs(): void {
  stores.forEach((e) => clearTimeout(e.timer))
  stores.clear()
}

/** Variables a graph can use: the menu graph's menu variables plus its own component variables (a menu graph just its own). */
export function visibleVariables(graph: Pick<Graph, 'variables' | 'scope'>, menu: Pick<Graph, 'variables'> | undefined): Graph['variables'] {
  return graph.scope === 'menu' || !menu ? graph.variables : [...menu.variables.filter((v) => v.scope === 'menu'), ...graph.variables.filter((v) => v.scope === 'component')]
}
