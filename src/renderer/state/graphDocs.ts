import type { Graph, NodeDef } from '@inkwell-ui/spec'
import { create } from 'zustand'
import type { InkwellApi } from '../../shared/ipc'
import { extractFunction } from '../../shared/functions'
import { emptyGraph, newGraphId, scriptsOf } from '../../shared/graphs'
import { inkwell } from '../hooks/api'
import { ownersOfGraph } from '../model/graphNav'
import type { OverlayDoc } from '../../shared/overlay'
import { dropGraphStore, findGraphStore, getGraphStore, resetGraphs, retargetCalls, saveGraphNow, setBlankHandlers, toGraph, type GraphStore } from './graphStore'
import { resetComponentGraphs } from './componentGraphs'
import { editNode, editNodeQuiet, getOverlayDoc } from './overlayStore'

/**
 * Which graphs each SWF has and which one the Graph panel shows. The graph files are loaded once per SWF (IPC `listGraphs` + `loadGraph`) into
 * `graphStore`s; this store keeps the ids (in file order) and the active graph. Creating or deleting a graph also edits the overlay `scripts`
 * of the layer it is attached to (`editNode`, next to the IPC call, as docs/graphs.md requires); main never edits overlays.
 * Create/delete go to disk at once and are not undoable (a graph's edits are, in the SWF's one history).
 */
interface DocsState {
  ids: Record<string, string[]>
  active: Record<string, string | undefined>
  loaded: Record<string, true>
  error: string | undefined
}
export const useGraphDocs = create<DocsState>(() => ({ ids: {}, active: {}, loaded: {}, error: undefined }))
type Api = Pick<InkwellApi, 'listGraphs' | 'loadGraph' | 'createGraph' | 'deleteGraph'>
type MoveApi = Pick<InkwellApi, 'deleteGraph' | 'addFunctionToLibrary'>
interface SwfRef {
  id: string
  name: string
}

const loading = new Map<string, Promise<void>>()
/** Loads the SWF's graphs once (later calls return the same promise). */
export function loadSwfGraphs(swf: SwfRef, api: Api): Promise<void> {
  if (useGraphDocs.getState().loaded[swf.id]) return Promise.resolve()
  const hit = loading.get(swf.id)
  if (hit) return hit
  const run = (async () => {
    const list = await api.listGraphs(swf.name)
    if (!list.ok) return void useGraphDocs.setState({ error: list.error })
    const graphs: Graph[] = []
    for (const g of list.graphs) {
      const r = await api.loadGraph(swf.name, g.id)
      if (r.ok) graphs.push(r.graph)
    }
    for (const g of graphs) getGraphStore(swf.id, swf.name, g)
    useGraphDocs.setState((s) => ({
      ids: { ...s.ids, [swf.id]: graphs.map((g) => g.id) },
      active: { ...s.active, [swf.id]: s.active[swf.id] ?? graphs.find((g) => g.scope === 'menu')?.id ?? graphs[0]?.id },
      loaded: { ...s.loaded, [swf.id]: true },
      error: undefined
    }))
  })().finally(() => loading.delete(swf.id))
  loading.set(swf.id, run)
  return run
}

export const setActiveGraph = (swfId: string, graphId: string | undefined): void => useGraphDocs.setState((s) => ({ active: { ...s.active, [swfId]: graphId } }))

/** The menu-scope graph of a SWF, if it has one (at most one exists). */
export const menuGraphId = (swfId: string): string | undefined =>
  (useGraphDocs.getState().ids[swfId] ?? []).find((id) => findGraphStore(swfId, id)?.getState().meta.scope === 'menu')

const scriptsPatch = (list: string[]): { scripts: string[] | null } => ({ scripts: list.length ? list : null })

/**
 * Layer graphs (docs/graphs.md): a layer has at most one graph and every layer has a canvas for it. The canvas of a layer with no graph is a blank draft that lives in memory only (its store is
 * `draft`, not in `ids`, not on disk). Once it holds something the graph is written, listed and attached to the layer's overlay `scripts`; when an edit, an undo or a redo leaves it blank again
 * the file is removed and the layer is detached. The attach and detach are derived from the graph's content, so they are not history entries of their own: the graph's own undo entries revert them.
 */
const drafts = new Map<string, string>() // `${swfId}/${layerId}` -> the graph id of the layer's blank canvas, kept for the session

/** Opens the graph of `layer` in the Graph panel: its existing graph, or its blank canvas. Returns the graph id. */
export function openLayerGraph(swf: SwfRef & { root: string }, layer: string, layerName: string): string {
  const key = `${swf.id}/${layer}`
  const ids = useGraphDocs.getState().ids[swf.id] ?? []
  let id = scriptsOf(getOverlayDoc(swf.id)?.nodes?.[layer]).find((g) => ids.includes(g)) ?? drafts.get(key)
  if (layer === swf.root && !id) id = menuGraphId(swf.id) // a menu graph that no overlay lists yet is still the frame's
  if (!id || !findGraphStore(swf.id, id)) {
    const scope: Graph['scope'] = layer === swf.root && !menuGraphId(swf.id) ? 'menu' : 'component'
    const name = layer === swf.root ? swf.name : layerName
    id = newGraphId(name, new Set([...ids, ...drafts.values()]))
    getGraphStore(swf.id, swf.name, emptyGraph(id, name, scope), true)
    drafts.set(key, id)
  }
  setActiveGraph(swf.id, id)
  return id
}

/** A layer graph got content (`blank` false) or lost it (true): list and attach it, or unlist and detach it. Registered with the graph store below. */
export function layerGraphChange(swfId: string, graphId: string, blank: boolean): void {
  const owners = ownersOfGraph(getOverlayDoc(swfId), graphId)
  const draftOwner = [...drafts].find(([k, v]) => k.startsWith(`${swfId}/`) && v === graphId)?.[0].slice(swfId.length + 1)
  if (blank) {
    for (const layer of owners) {
      drafts.set(`${swfId}/${layer}`, graphId) // the layer keeps this store as its blank canvas
      const list = scriptsOf(getOverlayDoc(swfId)?.nodes?.[layer])
      editNodeQuiet(swfId, layer, scriptsPatch(list.filter((id) => id !== graphId)))
    }
    useGraphDocs.setState((s) => ({ ids: { ...s.ids, [swfId]: (s.ids[swfId] ?? []).filter((id) => id !== graphId) } }))
    return
  }
  if (draftOwner && !owners.includes(draftOwner)) editNodeQuiet(swfId, draftOwner, scriptsPatch([...scriptsOf(getOverlayDoc(swfId)?.nodes?.[draftOwner]), graphId]))
  useGraphDocs.setState((s) => ((s.ids[swfId] ?? []).includes(graphId) ? s : { ids: { ...s.ids, [swfId]: [...(s.ids[swfId] ?? []), graphId] } }))
}
setBlankHandlers({ change: layerGraphChange, remove: (swfName, graphId) => void inkwell?.deleteGraph(swfName, graphId) })

const addId = (swfId: string, id: string, activate: boolean): void =>
  useGraphDocs.setState((s) => ({ ids: { ...s.ids, [swfId]: [...(s.ids[swfId] ?? []), id] }, active: activate ? { ...s.active, [swfId]: id } : s.active }))

/** `[+ Function]`: a function graph. It is called from other graphs, so unlike a menu or component graph it is not attached to a layer (no overlay `scripts`). */
export async function addFunction(o: { swf: SwfRef; name: string }, api: Api): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const r = await api.createGraph(o.swf.name, o.name, 'function')
  if (!r.ok) return r
  getGraphStore(o.swf.id, o.swf.name, r.graph)
  addId(o.swf.id, r.graph.id, true)
  return { ok: true, id: r.graph.id }
}

/**
 * Turns the selected nodes of `store`'s graph into a new function (`shared/functions.ts` `extractFunction`): the function graph is created and saved, the selection in the open graph is
 * replaced by one Call Function node (one undo step in the open graph). The open graph stays open. Refused selections come back as `error` before anything is created.
 */
export async function makeFunction(o: { swf: SwfRef; store: GraphStore; selected: readonly string[]; name: string; defs: ReadonlyMap<string, NodeDef> }, api: Api): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const g = toGraph(o.store.getState())
  const sel = new Set(o.selected)
  const dry = extractFunction(g, sel, o.defs, { id: 'dry-run', name: o.name, callId: 'dry-run-call' })
  if (!dry.ok) return dry
  const created = await api.createGraph(o.swf.name, o.name, 'function')
  if (!created.ok) return created
  const r = extractFunction(g, sel, o.defs, { id: created.graph.id, name: o.name, callId: crypto.randomUUID() })
  if (!r.ok) return r
  getGraphStore(o.swf.id, o.swf.name, r.fn)
  saveGraphNow(o.swf.id, r.fn.id) // the file holds the empty default until now
  o.store.getState().applyGraph(r.caller)
  addId(o.swf.id, r.fn.id, false)
  return { ok: true, id: r.fn.id }
}

/**
 * Opens a library function in the Graph panel to edit it in place. Its store is named `@lib:<packId>`, so every change is saved back into that pack folder (`bridge.ts`); it is not one of the
 * SWF's own graphs (no entry in the SWF's list, so it never shows in the project's functions).
 */
export function openLibraryFunction(swf: SwfRef, fn: Graph): void {
  getGraphStore(swf.id, `@lib:${fn.id.split('/')[0]}`, fn)
  setActiveGraph(swf.id, fn.id)
}

/**
 * Opens a component's graph in the Graph panel (the active SWF only lends the panel). Its store is named `@comp:<component id>`, so every change is saved to the project's `components/` folder
 * (`bridge.ts`); it is not one of the SWF's graphs.
 */
export function openComponentGraph(swf: SwfRef, g: Graph): void {
  getGraphStore(swf.id, `@comp:${g.component}`, g)
  setActiveGraph(swf.id, g.id)
}

/**
 * Drag a function onto a pack: the function graph is written into the pack (`functions/<id>.json`), every call of it in the SWF now says `<packId>/<id>` and the SWF's own copy is deleted,
 * so the function lives in one place. Refused (nothing changed) when it calls a function that is still the SWF's own or the pack already has that id.
 */
export async function moveFunctionToPack(o: { swf: SwfRef; fnId: string; packId: string }, api: MoveApi): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const store = findGraphStore(o.swf.id, o.fnId)
  if (!store || store.getState().meta.scope !== 'function') return { ok: false, error: 'Only a function can be moved into a pack.' }
  const r = await api.addFunctionToLibrary(o.packId, toGraph(store.getState()))
  if (!r.ok) return r
  const to = `${o.packId}/${r.id}` // the pack numbers its functions: its id, not the project's
  retargetCalls(o.swf.id, o.fnId, to)
  dropGraphStore(o.swf.id, o.fnId)
  const d = await api.deleteGraph(o.swf.name, o.fnId)
  useGraphDocs.setState((s) => {
    const ids = (s.ids[o.swf.id] ?? []).filter((id) => id !== o.fnId)
    return { ids: { ...s.ids, [o.swf.id]: ids }, active: s.active[o.swf.id] === o.fnId ? { ...s.active, [o.swf.id]: ids[0] } : s.active }
  })
  return d.ok ? { ok: true, id: to } : d
}

/** Renames a library function without opening it (the change is saved into its pack like any edit of it). */
export const renameLibraryFunction = (swf: SwfRef, fn: Graph, name: string): void => getGraphStore(swf.id, `@lib:${fn.id.split('/')[0]}`, fn).getState().rename(name)

/** Forgets an open library function that was deleted from its pack (no late save may bring the file back). */
export function forgetLibraryFunction(swf: SwfRef, fnId: string): void {
  dropGraphStore(swf.id, fnId)
  useGraphDocs.setState((s) => ({ active: s.active[swf.id] === fnId ? { ...s.active, [swf.id]: menuGraphId(swf.id) ?? s.ids[swf.id]?.[0] } : s.active }))
}

/** "Copy to project": an editable function of the SWF with the library function's content. Calls it makes to other library functions stay library calls. */
export async function copyLibraryFunction(o: { swf: SwfRef; fn: Graph }, api: Api): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const created = await api.createGraph(o.swf.name, o.fn.name, 'function')
  if (!created.ok) return created
  const g: Graph = { ...o.fn, id: created.graph.id }
  getGraphStore(o.swf.id, o.swf.name, g)
  saveGraphNow(o.swf.id, g.id)
  addId(o.swf.id, g.id, true)
  return { ok: true, id: g.id }
}

/** Deletes the graph file and detaches its id from every layer that lists it (`scripts`). */
export async function removeGraph(o: { swf: SwfRef; overlay: OverlayDoc | undefined; graphId: string }, api: Api): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await api.deleteGraph(o.swf.name, o.graphId)
  if (!r.ok) return r
  dropGraphStore(o.swf.id, o.graphId)
  for (const [nodeId, entry] of Object.entries(o.overlay?.nodes ?? {})) {
    const list = scriptsOf(entry)
    if (list.includes(o.graphId)) editNode(o.swf.id, nodeId, scriptsPatch(list.filter((id) => id !== o.graphId)))
  }
  useGraphDocs.setState((s) => {
    const ids = (s.ids[o.swf.id] ?? []).filter((id) => id !== o.graphId)
    return { ids: { ...s.ids, [o.swf.id]: ids }, active: s.active[o.swf.id] === o.graphId ? { ...s.active, [o.swf.id]: ids[0] } : s.active }
  })
  return { ok: true }
}

/** Renames a graph (an undoable edit that is saved like any other). */
export const renameGraph = (swfId: string, graphId: string, name: string): void => findGraphStore(swfId, graphId)?.getState().rename(name)

/** Plain graph documents of a SWF's open graphs (siblings for validation, variables for the panels). */
export const openGraphs = (swfId: string): Graph[] =>
  (useGraphDocs.getState().ids[swfId] ?? []).flatMap((id) => {
    const s = findGraphStore(swfId, id)
    return s ? [toGraph(s.getState())] : []
  })

/** Another project was opened. */
export function resetGraphDocs(): void {
  resetGraphs()
  resetComponentGraphs()
  loading.clear()
  drafts.clear()
  useGraphDocs.setState({ ids: {}, active: {}, loaded: {}, error: undefined })
}
