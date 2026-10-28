import { FUNCTION_PIN_TYPES, type Graph, type GraphNode, type NodeDef } from '@inkwell-ui/spec'
import { resolvePins, type ResolvedPin } from './graphValidate'

/** Pure graph edits for functions (docs/functions.md): create one, point a call at its signature, change a signature, turn a selection into a function. Nothing here touches disk or a store. */

export type Signature = NonNullable<Graph['signature']>
type Edge = Graph['edges'][number]
type Defs = ReadonlyMap<string, NodeDef>
export type Fallible<T> = ({ ok: true } & T) | { ok: false; error: string }

const KIND = { entry: 'core/FunctionEntry@1', exit: 'core/FunctionExit@1', call: 'core/CallFunction@1' } as const
const is = (n: GraphNode, name: string): boolean => n.kind.split('/')[1]?.startsWith(`${name}@`) === true
const RESERVED = ['function', 'inputs', 'outputs', 'exits'] // the fields of a Call Function node, see the validator
const pinType = (t: string): boolean => (FUNCTION_PIN_TYPES as readonly string[]).includes(t)
const node = (id: string, kind: string, fields: Record<string, unknown>, x: number, y: number): GraphNode => ({ id, kind, fields, pos: { x, y } }) as GraphNode

/** A new function graph: Function Entry wired to a Function Exit of the one exit "Done". */
export function newFunctionGraph(id: string, name: string, newId: () => string = () => crypto.randomUUID()): Graph {
  const exit = { id: newId(), name: 'Done' }
  const fe = newId()
  const fx = newId()
  return {
    specVersion: 8, id, name, scope: 'function',
    signature: { inputs: [], outputs: [], exits: [exit] },
    nodes: [node(fe, KIND.entry, {}, 0, 0), node(fx, KIND.exit, { exit: exit.id }, 320, 0)],
    edges: [{ from: { node: fe, pin: 'then' }, to: { node: fx, pin: 'in' } }],
    variables: [], comments: [], groups: []
  } as Graph
}

const plain = (l: readonly { id: string; name: string; type?: string }[], withType: boolean): object[] => l.map((p) => (withType ? { id: p.id, name: p.name, type: p.type } : { id: p.id, name: p.name }))

/** The copy of a signature a Call Function node keeps in its fields. */
export const callFields = (fn: Graph): Record<string, unknown> => ({
  function: fn.id,
  inputs: plain(fn.signature?.inputs ?? [], true),
  outputs: plain(fn.signature?.outputs ?? [], true),
  exits: plain(fn.signature?.exits ?? [], false)
})

export const newCallNode = (fn: Graph, id: string, x: number, y: number): GraphNode => node(id, KIND.call, callFields(fn), x, y)

/** old name -> new name by pin id, for the pins that still exist. */
function renames(before: readonly { id: string; name: string }[], after: readonly { id: string; name: string }[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const b of before) {
    const a = after.find((x) => x.id === b.id)
    if (a) m.set(b.name, a.name)
  }
  return m
}

/** Edges of `nodeId` on one side, pin names mapped through `map`; a wire to a pin that is gone is dropped. `keep` lists pins that never change (the fixed `in`). */
function mapEdges(edges: readonly Edge[], nodeId: string, side: 'from' | 'to', map: Map<string, string>, keep: readonly string[] = []): Edge[] {
  return edges.flatMap((e) => {
    if (e[side].node !== nodeId) return [e]
    const pin = e[side].pin
    if (keep.includes(pin)) return [e]
    const next = map.get(pin)
    return next === undefined ? [] : [{ ...e, [side]: { ...e[side], pin: next } } as Edge]
  })
}

/** Points one Call Function node at the function's current signature: wires follow their pin by id (a rename keeps its wires), wires of removed pins are dropped, typed-in values of inputs follow the rename. */
export function refreshCall(g: Graph, nodeId: string, fn: Graph): Graph {
  const call = g.nodes.find((n) => n.id === nodeId)
  const sig = fn.signature
  if (!call || !sig) return g
  const list = (k: string): { id: string; name: string }[] => (Array.isArray(call.fields[k]) ? (call.fields[k] as { id: string; name: string }[]) : [])
  const inMap = renames(list('inputs'), sig.inputs)
  const outMap = new Map([...renames(list('outputs'), sig.outputs), ...renames(list('exits'), sig.exits)])
  let edges = mapEdges(g.edges, nodeId, 'to', inMap, ['in'])
  edges = mapEdges(edges, nodeId, 'from', outMap)
  const next = callFields(fn)
  // typed-in values live in the field named like the pin
  for (const [oldName, newName] of inMap) if (oldName in call.fields && !RESERVED.includes(oldName)) next[newName] = call.fields[oldName]
  const kept = Object.fromEntries(Object.entries(call.fields).filter(([k]) => !(['function', 'inputs', 'outputs', 'exits'].includes(k)) && !list('inputs').some((p) => p.name === k)))
  return { ...g, edges, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, fields: { ...kept, ...next } } : n)) }
}

/** Calls of `fn` in `g` whose copy of the signature is out of date (compared by id, name and type). */
export function staleCalls(g: Graph, fn: Graph): string[] {
  const want = JSON.stringify(callFields(fn))
  return g.nodes.filter((n) => is(n, 'CallFunction') && n.fields['function'] === fn.id && JSON.stringify(Object.fromEntries(['function', 'inputs', 'outputs', 'exits'].map((k) => [k, n.fields[k]]))) !== want).map((n) => n.id)
}

/** `g` with every stale call of `fn` refreshed; the same object when nothing was stale. */
export function refreshCalls(g: Graph, fn: Graph): Graph {
  return staleCalls(g, fn).reduce((acc, id) => refreshCall(acc, id, fn), g)
}

/**
 * Gives a function a new signature: the wires of its Function Entry (the inputs) and Function Exit nodes (the outputs) follow their pin by id, wires of removed pins are dropped.
 * Callers are refreshed separately (`refreshCalls`), after the function is saved.
 */
export function applySignature(fn: Graph, next: Signature): Graph {
  const old = fn.signature
  if (!old) return { ...fn, signature: next }
  const inMap = renames(old.inputs, next.inputs)
  const outMap = renames(old.outputs, next.outputs)
  let edges = fn.edges
  for (const n of fn.nodes) {
    if (is(n, 'FunctionEntry')) edges = mapEdges(edges, n.id, 'from', inMap, ['then'])
    if (is(n, 'FunctionExit')) edges = mapEdges(edges, n.id, 'to', outMap, ['in'])
  }
  return { ...fn, signature: next, edges }
}

// ---- extract ------------------------------------------------------------------------------------------------------------------------

const safeName = (raw: string, taken: Set<string>, extra: readonly string[] = []): string => {
  let base = raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'value'
  if (/^[0-9]/.test(base)) base = `_${base}`
  if (RESERVED.includes(base)) base = `${base}_`
  let name = base
  for (let k = 2; taken.has(name) || extra.includes(name); k++) name = `${base}_${k}`
  taken.add(name)
  return name
}

const endpoint = (e: Edge['from']): string => `${e.node}\u0000${e.pin}`

/**
 * Turns the selected nodes of `g` into a function and replaces them with a Call Function node. The pins come from the wires that cross the selection boundary:
 * one wire into the selection's exec input (the Function Entry feeds it), each exec wire that leaves it becomes an exit, a value coming in becomes an input,
 * a value used outside becomes an output. Refused (with a reason) when the selection uses events, graph variables, component-typed wires, or has several entry points.
 */
export function extractFunction(g: Graph, selected: ReadonlySet<string>, defs: Defs, o: { id: string; name: string; callId: string; newId?: () => string }): Fallible<{ fn: Graph; caller: Graph; call: string }> {
  const newId = o.newId ?? ((): string => crypto.randomUUID())
  const inside = g.nodes.filter((n) => selected.has(n.id))
  if (inside.length === 0) return { ok: false, error: 'Select the nodes to turn into a function.' }
  const pins = new Map<string, { def: NodeDef; pins: { inputs: ResolvedPin[]; outputs: ResolvedPin[] } }>()
  for (const n of inside) {
    const def = defs.get(n.kind)
    if (!def) return { ok: false, error: `${n.kind} is not installed, so it cannot be moved into a function.` }
    const x = def.extra as { entry?: boolean; editorOnly?: boolean } | undefined
    if (x?.entry) return { ok: false, error: `${def.title} is an event; it stays in the graph and calls the function.` }
    if (is(n, 'FunctionEntry') || is(n, 'FunctionExit')) return { ok: false, error: `${def.title} belongs to a function already.` }
    const used = g.variables.find((v) => Object.values(n.fields).includes(v.id))
    if (used) return { ok: false, error: `${def.title} uses the graph variable "${used.name}". A function cannot see the graph's variables yet; pass the value in as an input.` }
    pins.set(n.id, { def, pins: resolvePins(def, n, g.variables, g.signature) })
  }
  const pinOf = (e: Edge['from'] | Edge['to'], side: 'inputs' | 'outputs'): ResolvedPin | undefined => pins.get(e.node)?.pins[side].find((p) => p.name === e.pin)
  const inEdges: Edge[] = []
  const outEdges: Edge[] = []
  const innerEdges: Edge[] = []
  const rest: Edge[] = []
  for (const e of g.edges) {
    const a = selected.has(e.from.node)
    const b = selected.has(e.to.node)
    if (a && b) innerEdges.push(e)
    else if (!a && b) inEdges.push(e)
    else if (a && !b) outEdges.push(e)
    else rest.push(e)
  }
  const execIn = inEdges.filter((e) => pinOf(e.to, 'inputs')?.type === 'Exec')
  const dataIn = inEdges.filter((e) => pinOf(e.to, 'inputs')?.type !== 'Exec')
  const execOut = outEdges.filter((e) => pinOf(e.from, 'outputs')?.type === 'Exec')
  const dataOut = outEdges.filter((e) => pinOf(e.from, 'outputs')?.type !== 'Exec')
  if (execIn.length === 0) return { ok: false, error: 'Nothing connects to the selection, so nothing would start the function. Wire an exec pin into the first selected node.' }
  const starts = new Set(execIn.map((e) => endpoint(e.to)))
  if (starts.size > 1) return { ok: false, error: 'The selection is entered at more than one place. Select nodes with a single entry point.' }
  const start = execIn[0]!.to

  // signature
  const inputNames = new Set<string>()
  const inputs: Signature['inputs'] = []
  const inputOf = new Map<string, string>() // outside source endpoint -> input name
  for (const e of dataIn) {
    const src = endpoint(e.from)
    if (inputOf.has(src)) continue
    const tp = pinOf(e.to, 'inputs')!
    if (!pinType(tp.type)) return { ok: false, error: `The input "${e.to.pin}" is a ${tp.type} (a Figma layer); a function cannot take that. Select the node that sets the layer's target differently or keep it outside.` }
    const name = safeName(e.to.pin, inputNames)
    inputOf.set(src, name)
    inputs.push({ id: newId(), name, type: tp.type as never } as never)
  }
  const outputNames = new Set<string>()
  const exitNames = new Set<string>()
  const outputs: Signature['outputs'] = []
  const outputOf = new Map<string, string>() // inside source endpoint -> output name
  for (const e of dataOut) {
    const src = endpoint(e.from)
    if (outputOf.has(src)) continue
    const sp = pinOf(e.from, 'outputs')!
    if (!pinType(sp.type)) return { ok: false, error: `The value "${e.from.pin}" used outside is a ${sp.type}; a function cannot return that.` }
    outputOf.set(src, safeName(e.from.pin, outputNames))
    outputs.push({ id: newId(), name: outputOf.get(src)!, type: sp.type as never } as never)
  }
  // exits: one per distinct exec pin that leaves the selection; none leaving -> a single "Done" reached by the pins that end the flow
  const exitOf = new Map<string, { id: string; name: string }>()
  for (const e of execOut) {
    const src = endpoint(e.from)
    if (!exitOf.has(src)) exitOf.set(src, { id: newId(), name: safeName(e.from.pin, exitNames, [...outputNames]) })
  }
  const exits: Signature['exits'] = [...exitOf.values()]
  const terminals: Edge['from'][] = []
  if (exits.length === 0) {
    exits.push({ id: newId(), name: safeName('Done', exitNames, [...outputNames]) })
    for (const n of inside)
      for (const p of pins.get(n.id)!.pins.outputs)
        if (p.type === 'Exec' && !g.edges.some((e) => e.from.node === n.id && e.from.pin === p.name)) terminals.push({ node: n.id, pin: p.name })
  }
  for (const x of exits) for (const out of outputNames) if (out === x.name) return { ok: false, error: `The exit "${x.name}" and an output share a name.` }

  // the function graph: Entry, the moved nodes (shifted to the left), one Exit node per exit
  const minX = Math.min(...inside.map((n) => n.pos.x))
  const minY = Math.min(...inside.map((n) => n.pos.y))
  const maxX = Math.max(...inside.map((n) => n.pos.x))
  const fe = newId()
  const fnNodes: GraphNode[] = [node(fe, KIND.entry, {}, 0, 0), ...inside.map((n) => ({ ...n, pos: { ...n.pos, x: n.pos.x - minX + 320, y: n.pos.y - minY } }) as GraphNode)]
  const fnEdges: Edge[] = [...innerEdges, { from: { node: fe, pin: 'then' }, to: start } as Edge]
  for (const e of dataIn) fnEdges.push({ from: { node: fe, pin: inputOf.get(endpoint(e.from))! }, to: e.to } as Edge)
  exits.forEach((x, k) => {
    const id = newId()
    fnNodes.push(node(id, KIND.exit, { exit: x.id }, maxX - minX + 700, k * 140))
    const feeders = exitOf.size ? [...exitOf].filter(([, v]) => v === x).map(([s]) => { const [n, p] = s.split('\u0000'); return { node: n!, pin: p! } }) : terminals
    for (const f of feeders) fnEdges.push({ from: f, to: { node: id, pin: 'in' } } as Edge)
    for (const [src, name] of outputOf) { const [n, p] = src.split('\u0000'); fnEdges.push({ from: { node: n!, pin: p! }, to: { node: id, pin: name } } as Edge) }
  })
  const fn: Graph = { specVersion: 8, id: o.id, name: o.name, scope: 'function', signature: { inputs, outputs, exits }, nodes: fnNodes, edges: fnEdges, variables: [], comments: [], groups: [] } as Graph

  // the caller: the selection becomes one call, the outside wires move onto its pins
  const cx = inside.reduce((s, n) => s + n.pos.x, 0) / inside.length
  const cy = inside.reduce((s, n) => s + n.pos.y, 0) / inside.length
  const call = newCallNode(fn, o.callId, cx, cy)
  const callerEdges: Edge[] = [...rest]
  for (const e of execIn) callerEdges.push({ ...e, to: { node: o.callId, pin: 'in' } } as Edge)
  for (const e of dataIn) callerEdges.push({ ...e, to: { node: o.callId, pin: inputOf.get(endpoint(e.from))! } } as Edge)
  for (const e of execOut) callerEdges.push({ ...e, from: { node: o.callId, pin: exitOf.get(endpoint(e.from))!.name } } as Edge)
  for (const e of dataOut) callerEdges.push({ ...e, from: { node: o.callId, pin: outputOf.get(endpoint(e.from))! } } as Edge)
  const caller: Graph = {
    ...g,
    nodes: [...g.nodes.filter((n) => !selected.has(n.id)), call],
    edges: callerEdges,
    groups: g.groups.map((gr) => ({ ...gr, nodes: gr.nodes.filter((id) => !selected.has(id)) }))
  }
  return { ok: true, fn, caller, call: o.callId }
}
