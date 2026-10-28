import { pinCompat, PinType, SAVED_LIMITS, SAVED_TYPES, type Graph, type GraphNode, type NodeDef } from '@inkwell-ui/spec'
import type { Issue } from '@nicklaj/knotwork'
import { nodeName } from './graphs'

/** Codes of graph issues; the Lint dock, the export gate and Strict Mode show them like compiler lint. */
export type GraphCode =
  | 'graph-type-mismatch'
  | 'graph-required-pin'
  | 'graph-dangling-exec'
  | 'graph-exec-cycle'
  | 'graph-target-missing'
  | 'graph-unknown-node'
  | 'graph-duplicate-handler'
  | 'graph-bad-wire'
  | 'graph-widget-call'
  | 'graph-function'
  | 'graph-prop'
  | 'runtime-required'
  | 'saved-variable-invalid'
  | 'contract-node-target'

/** A Knotwork Issue pinned to a graph node id, plus where it lives. `targetId` is the Figma node id for `graph-target-missing`. */
export type GraphIssue = Issue<{ code: GraphCode; graphId: string; targetId?: string; pin?: string }>

export interface ResolvedPin {
  name: string
  type: PinType
  /** Present when the pack gave the pin a default: such an input needs no wire or value. */
  hasDefault: boolean
}

export interface ValidateCtx {
  /** Node definitions by `packId/kind@major`. */
  defs: ReadonlyMap<string, NodeDef>
  /** Figma node ids that exist in the SWF's IR; undefined = unknown, the target check is skipped. */
  layers?: ReadonlySet<string>
  /** The other graphs of the same SWF, for the duplicate event handler check. */
  siblings?: readonly Graph[]
  /** The SWF's target kind (S7, S9): a HUD widget runs without the Inkwell Runtime (lint `runtime-required`), `saved` variables belong to a custom menu. Absent = those checks are skipped. */
  target?: 'hudWidget' | 'customMenu' | 'menuReplacement'
  /** Library functions of the installed packs by `<packId>/<functionId>` (Call Function nodes may call them). */
  library?: ReadonlyMap<string, Graph>
  /** A menu replacement's `target.contract` (W5): contract nodes (`NodeDef.contract`) are only allowed in a replacement of that contract. */
  contract?: string
}

/** S7/S8: the node only works in a custom menu served by the Inkwell Runtime (the definition's `requiresRuntime`; core pack 0.3.0 sets it on all 20 such nodes). */
export const needsRuntime = (d: NodeDef): boolean => d.requiresRuntime === true

/** W5: the contract (engine menu) a contract node talks to: the node field `contract` (Spec `NodeDef.contract`, core pack 0.5.3), else `extra.contract` of packs before it; undefined for every other node. */
export const nodeContract = (d: NodeDef): string | undefined => {
  const c = d.contract ?? (d.extra as { contract?: unknown } | undefined)?.contract
  return typeof c === 'string' ? c : undefined
}

const isPinType = (v: unknown): v is PinType => PinType.safeParse(v).success
const isEntry = (d: NodeDef): boolean => (d.extra as { entry?: unknown } | undefined)?.entry === true
export const isFunctionEntry = (d: NodeDef): boolean => (d.extra as { functionEntry?: unknown } | undefined)?.functionEntry === true
export const isFunctionExit = (d: NodeDef): boolean => (d.extra as { signatureInputs?: unknown } | undefined)?.signatureInputs !== undefined
/** The field of a Call Function node that names the function graph (`extra.callsFunction`), undefined for every other node. */
export const callsFunction = (d: NodeDef): string | undefined => {
  const f = (d.extra as { callsFunction?: unknown } | undefined)?.callsFunction
  return typeof f === 'string' ? f : undefined
}
const isEditorOnly = (d: NodeDef): boolean => (d.extra as { editorOnly?: unknown } | undefined)?.editorOnly === true
const component = (t: PinType): boolean => t === 'Text' || t === 'Button' || t === 'List' || t === 'Image' || t === 'Clip'

/**
 * Effective pins of a node. `typeFrom: "<field>"` takes the type from the field (a pin type name) or from the graph variable whose id is in the field
 * (`connection` stays at the declared type); `extra.dynamicOutputs` / `extra.dynamicInputs: "<field>"` append one data output / input per `{name, type}` entry of that array field (On Widget Call params / Call Widget args).
 * Functions: `extra.dynamicExits: "<field>"` appends one Exec output per `{name}` entry (Call Function); `extra.signatureOutputs` / `extra.signatureInputs: "inputs" | "outputs"`
 * append data pins from that list of the graph's own `signature` (Function Entry / Function Exit), so `sig` is the signature of the graph the node lives in.
 */
export function resolvePins(def: NodeDef, node: Pick<GraphNode, 'fields'>, vars: Graph['variables'], sig?: Graph['signature']): { inputs: ResolvedPin[]; outputs: ResolvedPin[] } {
  const typed = (p: NodeDef['inputs'][number]): ResolvedPin => {
    const f = (p as { typeFrom?: unknown }).typeFrom
    const v = typeof f === 'string' && f !== 'connection' ? node.fields[f] : undefined
    const t = isPinType(v) ? v : (vars.find((x) => x.id === v)?.type ?? p.type)
    return { name: p.name, type: t, hasDefault: Object.hasOwn(p, 'default') }
  }
  const dynamic = (key: 'dynamicOutputs' | 'dynamicInputs'): ResolvedPin[] => {
    const f = (def.extra as Record<string, unknown> | undefined)?.[key]
    const list = typeof f === 'string' && Array.isArray(node.fields[f]) ? (node.fields[f] as { name?: unknown; type?: unknown }[]) : []
    return list.flatMap((p) => (typeof p?.name === 'string' && isPinType(p.type) ? [{ name: p.name, type: p.type, hasDefault: true }] : []))
  }
  const extra = def.extra as Record<string, unknown> | undefined
  const exits = (): ResolvedPin[] => {
    const f = extra?.['dynamicExits']
    const list = typeof f === 'string' && Array.isArray(node.fields[f]) ? (node.fields[f] as { name?: unknown }[]) : []
    return list.flatMap((x) => (typeof x?.name === 'string' ? [{ name: x.name, type: 'Exec' as const, hasDefault: false }] : []))
  }
  const fromSig = (key: 'signatureInputs' | 'signatureOutputs'): ResolvedPin[] => {
    const which = extra?.[key]
    const list = which === 'inputs' || which === 'outputs' ? sig?.[which] : undefined
    return (list ?? []).map((p) => ({ name: p.name, type: p.type, hasDefault: true }))
  }
  return {
    inputs: [...def.inputs.map(typed), ...dynamic('dynamicInputs'), ...fromSig('signatureInputs')],
    outputs: [...def.outputs.map(typed), ...exits(), ...dynamic('dynamicOutputs'), ...fromSig('signatureOutputs')]
  }
}

const kindOf = (n: GraphNode): string => n.kind.split('/')[1] ?? ''
const widgetParams = (n: GraphNode): string => (Array.isArray(n.fields['params']) ? (n.fields['params'] as { type?: unknown }[]).map((p) => String(p?.type)).join(',') : '')

/** Key that makes two entry nodes handle the same event: kind, handler name (On Widget Call) and target layer. */
const handlerKey = (n: GraphNode, d: NodeDef): string => {
  const target = d.inputs.find((p) => component(p.type))?.name
  return [n.kind, nodeName(n, d), target && typeof n.fields[target] === 'string' ? n.fields[target] : ''].join('|')
}

/**
 * The one validation of a graph (CLAUDE.md "One validation source"). Pure; the main process runs it for the Lint dock and the export gate, the
 * renderer for live node badges through Knotwork's `createValidation`. A component-typed input pin without a wire takes its Figma layer id from
 * `fields[<pin name>]` (docs/graphs.md). Issues are pinned to graph node ids; nothing here ever changes the graph.
 */
export function validateGraph(g: Graph, ctx: ValidateCtx): GraphIssue[] {
  const out: GraphIssue[] = []
  const add = (nodeId: string, code: GraphCode, level: 'error' | 'warning', message: string, extra: { targetId?: string; pin?: string } = {}): void => {
    out.push({ level, message, nodeId, code, graphId: g.id, ...extra })
  }
  const nodes = new Map(g.nodes.map((n) => [n.id, n]))
  const pins = new Map<string, ReturnType<typeof resolvePins>>()
  const defOf = new Map<string, NodeDef>()
  for (const n of g.nodes) {
    const d = ctx.defs.get(n.kind)
    if (!d) {
      add(n.id, 'graph-unknown-node', 'error', `Unknown Pack Node (Data Preserved): ${n.kind}. Install the pack that defines it; the node is kept as it is.`)
      continue
    }
    defOf.set(n.id, d)
    pins.set(n.id, resolvePins(d, n, g.variables, g.signature))
  }
  const wiredInputs = new Map<string, Set<string>>() // node id -> input pins with a wire
  const execOut = new Map<string, string[]>() // node id -> successors over Exec wires
  const execIn = new Set<string>() // node ids with an incoming Exec wire
  for (const e of g.edges) {
    const a = nodes.get(e.from.node)
    const b = nodes.get(e.to.node)
    if (!a || !b) {
      const here = a ?? b
      if (here) add(here.id, 'graph-bad-wire', 'error', `A wire points to the missing node "${a ? e.to.node : e.from.node}".`)
      continue
    }
    if (!wiredInputs.has(b.id)) wiredInputs.set(b.id, new Set())
    wiredInputs.get(b.id)!.add(e.to.pin)
    if (!pins.has(a.id) || !pins.has(b.id)) continue // an unknown node: its pins are unknown, its wires are kept untouched
    const pa = pins.get(a.id)!.outputs.find((p) => p.name === e.from.pin)
    const pb = pins.get(b.id)!.inputs.find((p) => p.name === e.to.pin)
    if (!pa || !pb) {
      const bad = pa ? e.to.pin : e.from.pin
      add(pa ? b.id : a.id, 'graph-bad-wire', 'error', `A wire uses the pin "${bad}", which the node does not have.`, { pin: bad })
      continue
    }
    if ((pa.type === 'Exec') !== (pb.type === 'Exec')) {
      add(b.id, 'graph-type-mismatch', 'error', `An exec pin cannot be wired to a ${pa.type === 'Exec' ? pb.type : pa.type} pin.`, { pin: e.to.pin })
    } else if (pa.type === 'Exec') {
      if (!execOut.has(a.id)) execOut.set(a.id, [])
      execOut.get(a.id)!.push(b.id)
      execIn.add(b.id)
    } else if (pinCompat(pa.type, pb.type) === 'none') {
      add(b.id, 'graph-type-mismatch', 'error', `${pa.type} cannot be wired to ${pb.type} (use a To String / To Number node).`, { pin: e.to.pin })
    }
  }
  // S5/S7: runtime-only nodes outside a custom menu (a HUD widget and a menu replacement have no Inkwell bridge), and the rules of `saved` variables
  if (ctx.target === 'hudWidget' || ctx.target === 'menuReplacement')
    for (const n of g.nodes) {
      const d = defOf.get(n.id)
      const where = ctx.target === 'hudWidget' ? 'a HUD widget' : 'a menu replacement'
      if (d && needsRuntime(d)) add(n.id, 'runtime-required', 'warning', `${d.title} needs the Inkwell Runtime and does nothing in ${where} (only a custom menu is served by the runtime).`)
    }
  // W5: a contract node talks to one engine menu, so it is an error anywhere but a replacement of that menu
  if (ctx.target !== undefined)
    for (const n of g.nodes) {
      const d = defOf.get(n.id)
      const c = d ? nodeContract(d) : undefined
      if (c && (ctx.target !== 'menuReplacement' || ctx.contract !== c))
        add(n.id, 'contract-node-target', 'error', `${d!.title} only works in a menu replacement whose contract is "${c}" (this SWF: ${ctx.target === 'menuReplacement' ? `contract "${ctx.contract ?? 'none'}"` : ctx.target}).`)
    }
  const saved = g.variables.filter((v) => v.scope === 'saved')
  if (saved.length && g.nodes.length) {
    const at = (v: Graph['variables'][number]): string => (g.nodes.find((n) => n.fields['variable'] === v.id) ?? g.nodes[0]!).id
    const others = new Set((ctx.siblings ?? []).filter((s) => s.id !== g.id).flatMap((s) => s.variables.filter((v) => v.scope === 'saved').map((v) => v.name)))
    const mine = new Set<string>()
    for (const v of saved) {
      if (ctx.target === 'hudWidget') add(at(v), 'runtime-required', 'warning', `The saved variable "${v.name}" needs the Inkwell Runtime; a HUD widget does not keep it.`)
      else if (g.scope !== 'menu' || (ctx.target !== undefined && ctx.target !== 'customMenu')) add(at(v), 'saved-variable-invalid', 'error', `The saved variable "${v.name}" is only allowed in the menu graph of a custom menu.`)
      if (mine.has(v.name) || others.has(v.name)) add(at(v), 'saved-variable-invalid', 'error', `The saved variable name "${v.name}" is used twice in this SWF.`)
      if (!(SAVED_TYPES as readonly string[]).includes(v.type)) add(at(v), 'saved-variable-invalid', 'error', `The saved variable "${v.name}" is ${v.type}; a saved variable must be Bool, Number or String.`)
      if (new TextEncoder().encode(v.name).length > SAVED_LIMITS.keyBytes || v.name === '') add(at(v), 'saved-variable-invalid', 'error', `The saved variable name "${v.name}" must be 1 to ${SAVED_LIMITS.keyBytes} bytes.`)
      mine.add(v.name)
    }
  }
  const handlers = new Map<string, string>() // handler key -> name of the graph that has it first
  for (const s of ctx.siblings ?? []) {
    if (s.id === g.id) continue
    for (const n of s.nodes) {
      const d = ctx.defs.get(n.kind)
      if (d && isEntry(d) && !isFunctionEntry(d) && !handlers.has(handlerKey(n, d))) handlers.set(handlerKey(n, d), s.name)
    }
  }
  for (const n of g.nodes) {
    const d = defOf.get(n.id)
    if (!d || isEditorOnly(d)) continue
    const wired = wiredInputs.get(n.id)
    const mine = pins.get(n.id)!
    for (const p of mine.inputs) {
      if (p.type === 'Exec' || wired?.has(p.name)) continue
      const v = n.fields[p.name]
      if (component(p.type) && typeof v === 'string' && v !== '') {
        if (ctx.layers && !ctx.layers.has(v)) {
          add(n.id, 'graph-target-missing', 'error', `The Figma layer this node targets (${v}) no longer exists. The node is kept; point it at another layer.`, { targetId: v, pin: p.name })
        }
      } else if (!p.hasDefault) {
        add(n.id, 'graph-required-pin', 'error', `The "${p.name}" input needs a wire${component(p.type) ? ' or a target layer' : ''}.`, { pin: p.name })
      }
    }
    if (isEntry(d) && !isFunctionEntry(d)) {
      const k = handlerKey(n, d)
      const first = handlers.get(k)
      if (first !== undefined) {
        const where = first === g.name ? 'node in this graph' : `graph "${first}"`
        add(n.id, 'graph-duplicate-handler', 'error', `Another ${where} already handles ${d.title} for the same target or name.`)
      } else handlers.set(k, g.name)
    } else if (!isEntry(d) && mine.inputs.some((p) => p.type === 'Exec') && !execIn.has(n.id)) {
      add(n.id, 'graph-dangling-exec', 'warning', `${d.title} is not reached by any event: its exec input has no wire, so it never runs.`)
    }
  }
  widgetCalls(g, defOf, execOut, add)
  functions(g, defOf, ctx.siblings ?? [], ctx.library ?? new Map(), add)
  propNodes(g, defOf, add)
  // cycle in exec flow: iterative DFS, reports the node that closes each loop
  const state = new Map<string, 1 | 2>()
  for (const root of execOut.keys()) {
    if (state.has(root)) continue
    const stack: { id: string; i: number }[] = [{ id: root, i: 0 }]
    state.set(root, 1)
    while (stack.length) {
      const top = stack[stack.length - 1]!
      const next = execOut.get(top.id)?.[top.i++]
      if (next === undefined) {
        state.set(top.id, 2)
        stack.pop()
      } else if (state.get(next) === 1) {
        add(next, 'graph-exec-cycle', 'error', 'The exec flow loops back to this node; a cycle would never finish. Use For Each for loops.')
      } else if (!state.has(next)) {
        state.set(next, 1)
        stack.push({ id: next, i: 0 })
      }
    }
  }
  return out
}

/**
 * Call Widget runs the On Widget Call of the same graph (`__g.<name>`), so the handler must exist with the same parameter types, and the call must not
 * lead back into its own handler (an exec cycle through two handlers would never finish). Reachability follows the exec wires, so a Delay counts as a step.
 */
function widgetCalls(g: Graph, defOf: ReadonlyMap<string, NodeDef>, execOut: ReadonlyMap<string, string[]>, add: (nodeId: string, code: GraphCode, level: 'error' | 'warning', message: string) => void): void {
  const nm = (n: GraphNode): string => nodeName(n, defOf.get(n.id)) // the pack default counts: an untouched On Widget Call is "Show" without a stored name
  const handlers = new Map(g.nodes.filter((n) => defOf.has(n.id) && kindOf(n).startsWith('OnWidgetCall@')).map((n) => [nm(n), n]))
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const callsIn = new Map<string, GraphNode[]>() // handler name -> Call Widget nodes its flow reaches
  for (const [name, h] of handlers) {
    const seen = new Set([h.id])
    const stack = [h.id]
    for (let id = stack.pop(); id !== undefined; id = stack.pop())
      for (const next of execOut.get(id) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        stack.push(next)
        const c = byId.get(next)
        if (c && kindOf(c).startsWith('CallWidget@')) callsIn.set(name, [...(callsIn.get(name) ?? []), c])
      }
  }
  const leadsTo = (from: string, to: string, seen = new Set<string>()): boolean =>
    from === to || (!seen.has(from) && (seen.add(from), (callsIn.get(from) ?? []).some((c) => leadsTo(nm(c), to, seen))))
  for (const c of g.nodes) {
    if (!defOf.has(c.id) || !kindOf(c).startsWith('CallWidget@')) continue
    const name = nm(c)
    const target = handlers.get(name)
    if (!target) add(c.id, 'graph-widget-call', 'error', `This graph has no On Widget Call named "${name}" to call.`)
    else if (widgetParams(target) !== widgetParams(c)) add(c.id, 'graph-widget-call', 'error', `The parameters of "${name}" differ from its On Widget Call node (same types in the same order are needed).`)
  }
  for (const [name, calls] of callsIn)
    for (const c of calls) if (leadsTo(nm(c), name)) add(c.id, 'graph-widget-call', 'error', `Calling "${nm(c)}" from "${name}" leads back into "${name}"; the call would never finish.`)
}

const AS2_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const CALL_FIELDS = ['function', 'inputs', 'outputs', 'exits']
const sameList = (a: readonly object[], b: readonly object[], keys: string[]): boolean =>
  a.length === b.length && a.every((x, i) => keys.every((k) => (x as Record<string, unknown>)[k] === (b[i] as Record<string, unknown>)[k]))

/**
 * Functions (docs/functions.md): a function graph has one Function Entry, its Function Exit nodes name an exit of its signature, the signature names are AS2 identifiers,
 * and no other graph has Entry or Exit nodes. Call Function must name a function graph of the same SWF, hold an up-to-date copy of its signature (compared by id,
 * name and type) and must not lead back into its own function (a recursion would never finish).
 */
/** Get Prop (`extra.readsProp`) reads a prop of the component the graph belongs to: only a component graph has props, and the prop has to exist. */
function propNodes(g: Graph, defOf: ReadonlyMap<string, NodeDef>, add: (nodeId: string, code: GraphCode, level: 'error' | 'warning', message: string) => void): void {
  for (const n of g.nodes) {
    const d = defOf.get(n.id)
    const key = (d?.extra as { readsProp?: unknown } | undefined)?.readsProp
    if (!d || typeof key !== 'string') continue
    if (g.scope !== 'blueprint') add(n.id, 'graph-prop', 'error', `${d.title} only works in a component graph.`)
    else if (!(g.props ?? []).some((p) => p.id === n.fields[key])) add(n.id, 'graph-prop', 'error', `${d.title}: pick a prop of this component${typeof n.fields[key] === 'string' && n.fields[key] ? ' (the one it read is gone)' : ''}.`)
  }
}

function functions(g: Graph, defOf: ReadonlyMap<string, NodeDef>, siblings: readonly Graph[], library: ReadonlyMap<string, Graph>, add: (nodeId: string, code: GraphCode, level: 'error' | 'warning', message: string) => void): void {
  const fns = new Map([...library, ...siblings.filter((s) => s.scope === 'function' && s.signature).map((s) => [s.id, s] as const)])
  if (g.scope === 'function' && g.signature) fns.set(g.id, g)
  const mine = g.nodes.flatMap((n) => (defOf.has(n.id) ? [{ n, d: defOf.get(n.id)! }] : []))
  const anchor = mine[0]?.n.id
  if (g.scope !== 'function') {
    for (const { n, d } of mine) if (isFunctionEntry(d) || isFunctionExit(d)) add(n.id, 'graph-function', 'error', `${d.title} only works in a function graph.`)
  } else {
    const sig = g.signature
    const entries = mine.filter(({ d }) => isFunctionEntry(d))
    if (entries.length === 0 && anchor) add(anchor, 'graph-function', 'error', 'A function needs a Function Entry node: nothing starts it.')
    for (const { n } of entries.slice(1)) add(n.id, 'graph-function', 'error', 'A function has one Function Entry.')
    for (const { n, d } of mine) if ((d.extra as { entry?: unknown } | undefined)?.entry === true && !isFunctionEntry(d)) add(n.id, 'graph-function', 'error', `${d.title} is an event; a function is started by its Function Entry.`)
    if (sig) {
      const exitIds = new Set(sig.exits.map((x) => x.id))
      const used = new Set<string>()
      for (const { n, d } of mine) {
        if (!isFunctionExit(d)) continue
        const id = String(n.fields['exit'] ?? '')
        if (!exitIds.has(id)) add(n.id, 'graph-function', 'error', 'This Function Exit does not name an exit of the signature; pick one.')
        used.add(id)
      }
      if (anchor) {
        for (const x of sig.exits) if (!used.has(x.id)) add(anchor, 'graph-function', 'warning', `The exit "${x.name}" has no Function Exit node, so a caller never continues through it.`)
        for (const [kind, list] of [['input', sig.inputs], ['output', sig.outputs], ['exit', sig.exits]] as const)
          for (const p of list) if (!AS2_NAME.test(p.name)) add(anchor, 'graph-function', 'error', `The ${kind} name "${p.name}" must be a plain identifier (letters, digits, underscore; not starting with a digit).`)
        // an unwired input of a Call Function node reads the node's field of the same name, so these four names would read its own settings
        for (const p of sig.inputs) if (CALL_FIELDS.includes(p.name)) add(anchor, 'graph-function', 'error', `The input name "${p.name}" is reserved (a call node keeps its settings under that name); pick another.`)
        for (const o of sig.outputs) if (sig.exits.some((x) => x.name === o.name)) add(anchor, 'graph-function', 'error', `"${o.name}" is both an output and an exit; a call node could not tell the two pins apart.`)
      }
    }
  }
  const callees = (f: Graph): string[] => f.nodes.flatMap((n) => (typeof n.fields['function'] === 'string' && n.kind.split('/')[1]?.startsWith('CallFunction@') ? [n.fields['function'] as string] : []))
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean =>
    from === target || (!seen.has(from) && (seen.add(from), (fns.has(from) ? callees(fns.get(from)!) : []).some((c) => reaches(c, target, seen))))
  for (const { n, d } of mine) {
    const field = callsFunction(d)
    if (!field) continue
    const target = String(n.fields[field] ?? '')
    const f = fns.get(target)
    if (!f?.signature) {
      add(n.id, 'graph-function', 'error', target === '' ? 'Pick the function this node calls.' : target.includes('/') ? `The library function "${target}" is not installed. Install the library that has it.` : `There is no function graph "${target}" in this SWF.`)
      continue
    }
    const s = f.signature
    const copy = (k: string): readonly object[] => (Array.isArray(n.fields[k]) ? (n.fields[k] as object[]) : [])
    if (!sameList(copy('inputs'), s.inputs, ['id', 'name', 'type']) || !sameList(copy('outputs'), s.outputs, ['id', 'name', 'type']) || !sameList(copy('exits'), s.exits, ['id', 'name']))
      add(n.id, 'graph-function', 'error', `The signature of "${f.name}" changed since this call was made; update the call.`)
    if (g.scope === 'function' && reaches(target, g.id)) add(n.id, 'graph-function', 'error', `Calling "${f.name}" leads back into "${g.name}"; a recursive call would never finish.`)
  }
}

/** Graph nodes whose targeted Figma layer is gone: the orphans of a graph (they stay in the file; the same rule as overlay entries). */
export function graphOrphans(g: Graph, ctx: { defs: ReadonlyMap<string, NodeDef>; layers: ReadonlySet<string> }): { nodeId: string; pin: string; targetId: string }[] {
  return validateGraph(g, ctx).flatMap((i) => (i.code === 'graph-target-missing' && i.nodeId && i.pin && i.targetId ? [{ nodeId: i.nodeId, pin: i.pin, targetId: i.targetId }] : []))
}
