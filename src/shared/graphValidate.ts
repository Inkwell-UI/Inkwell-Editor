import { GAME_BRIDGE_NODES, pinCompat, PinType, RUNTIME_ONLY_EVENTS, type Graph, type GraphNode, type NodeDef } from '@inkwell-ui/spec'
import type { Issue } from '@nicklaj/knotwork'

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
  | 'runtime-required'
  | 'saved-variable-invalid'

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
}

/** S7/S8: the node only works in a custom menu served by the Inkwell Runtime (its definition says `requiresRuntime`; the 0.2 pack copy predates the flag, so the Spec's title lists count too). */
export const needsRuntime = (d: NodeDef): boolean => d.requiresRuntime === true || (RUNTIME_ONLY_EVENTS as readonly string[]).includes(d.title) || (GAME_BRIDGE_NODES as readonly string[]).includes(d.title)

const isPinType = (v: unknown): v is PinType => PinType.safeParse(v).success
const isEntry = (d: NodeDef): boolean => (d.extra as { entry?: unknown } | undefined)?.entry === true
const isEditorOnly = (d: NodeDef): boolean => (d.extra as { editorOnly?: unknown } | undefined)?.editorOnly === true
const component = (t: PinType): boolean => t === 'Text' || t === 'Button' || t === 'List' || t === 'Image' || t === 'Clip'

/**
 * Effective pins of a node. `typeFrom: "<field>"` takes the type from the field (a pin type name) or from the graph variable whose id is in the field
 * (`connection` stays at the declared type); `extra.dynamicOutputs: "<field>"` appends one data output per `{name, type}` entry of that array field.
 */
export function resolvePins(def: NodeDef, node: Pick<GraphNode, 'fields'>, vars: Graph['variables']): { inputs: ResolvedPin[]; outputs: ResolvedPin[] } {
  const typed = (p: NodeDef['inputs'][number]): ResolvedPin => {
    const f = (p as { typeFrom?: unknown }).typeFrom
    const v = typeof f === 'string' && f !== 'connection' ? node.fields[f] : undefined
    const t = isPinType(v) ? v : (vars.find((x) => x.id === v)?.type ?? p.type)
    return { name: p.name, type: t, hasDefault: Object.hasOwn(p, 'default') }
  }
  const dyn = (def.extra as { dynamicOutputs?: unknown } | undefined)?.dynamicOutputs
  const params = typeof dyn === 'string' && Array.isArray(node.fields[dyn]) ? (node.fields[dyn] as { name?: unknown; type?: unknown }[]) : []
  return {
    inputs: def.inputs.map(typed),
    outputs: [...def.outputs.map(typed), ...params.flatMap((p) => (typeof p?.name === 'string' && isPinType(p.type) ? [{ name: p.name, type: p.type, hasDefault: true }] : []))]
  }
}

/** Key that makes two entry nodes handle the same event: kind, handler name (On Widget Call) and target layer. */
const handlerKey = (n: GraphNode, d: NodeDef): string => {
  const target = d.inputs.find((p) => component(p.type))?.name
  return [n.kind, typeof n.fields['name'] === 'string' ? n.fields['name'] : '', target && typeof n.fields[target] === 'string' ? n.fields[target] : ''].join('|')
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
    pins.set(n.id, resolvePins(d, n, g.variables))
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
  // S5/S7: runtime-only nodes in a HUD widget, and the rules of `saved` variables
  if (ctx.target === 'hudWidget')
    for (const n of g.nodes) {
      const d = defOf.get(n.id)
      if (d && needsRuntime(d)) add(n.id, 'runtime-required', 'warning', `${d.title} needs the Inkwell Runtime and does nothing in a HUD widget (only a custom menu is served by the runtime).`)
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
      mine.add(v.name)
    }
  }
  const handlers = new Map<string, string>() // handler key -> name of the graph that has it first
  for (const s of ctx.siblings ?? []) {
    if (s.id === g.id) continue
    for (const n of s.nodes) {
      const d = ctx.defs.get(n.kind)
      if (d && isEntry(d) && !handlers.has(handlerKey(n, d))) handlers.set(handlerKey(n, d), s.name)
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
    if (isEntry(d)) {
      const k = handlerKey(n, d)
      const first = handlers.get(k)
      if (first !== undefined) {
        const where = first === g.name ? 'node in this graph' : `graph "${first}"`
        add(n.id, 'graph-duplicate-handler', 'error', `Another ${where} already handles ${d.title} for the same target or name.`)
      } else handlers.set(k, g.name)
    } else if (mine.inputs.some((p) => p.type === 'Exec') && !execIn.has(n.id)) {
      add(n.id, 'graph-dangling-exec', 'warning', `${d.title} is not reached by any event: its exec input has no wire, so it never runs.`)
    }
  }
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

/** Graph nodes whose targeted Figma layer is gone: the orphans of a graph (they stay in the file; the same rule as overlay entries). */
export function graphOrphans(g: Graph, ctx: { defs: ReadonlyMap<string, NodeDef>; layers: ReadonlySet<string> }): { nodeId: string; pin: string; targetId: string }[] {
  return validateGraph(g, ctx).flatMap((i) => (i.code === 'graph-target-missing' && i.nodeId && i.pin && i.targetId ? [{ nodeId: i.nodeId, pin: i.pin, targetId: i.targetId }] : []))
}
