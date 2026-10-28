import { pinCompat, type Graph, type NodeDef, type PinType, type Swf } from '@inkwell-ui/spec'
import { composeRules, incoming, noSelfLink, outgoing, pinField, spawnOptions, SPAWN_NEW, type NodeDef as SpawnDef, type Rule, type SpawnOption } from '@nicklaj/knotwork'
import { nodeName } from '../../shared/graphs'
import { resolvePins, type ResolvedPin } from '../../shared/graphValidate'
import type { OverlayDoc } from '../../shared/overlay'
import { pinName, type FlowEdge, type FlowNode } from '../state/graphStore'

/** Pure logic of the graph canvas: pin look, connection rules, spawn menu, inline field rows, layer choices. Tested in graphModel.test.ts. */

// ---- pins ---------------------------------------------------------------------------------------------------------------------------

/** Shape AND colour (CSS variable in theme.css) per pin type; the colour is never the only cue (UX 4.4). Components share the frame shape, their colours and labels differ. */
export const PIN_STYLE: Record<PinType, { shape: 'triangle' | 'diamond' | 'circle' | 'square' | 'hexagon' | 'octagon' | 'frame'; color: string }> = {
  Exec: { shape: 'triangle', color: 'var(--pin-exec)' },
  Bool: { shape: 'diamond', color: 'var(--pin-bool)' },
  Number: { shape: 'circle', color: 'var(--pin-number)' },
  String: { shape: 'square', color: 'var(--pin-string)' },
  Array: { shape: 'hexagon', color: 'var(--pin-array)' },
  Object: { shape: 'octagon', color: 'var(--pin-object)' },
  Text: { shape: 'frame', color: 'var(--pin-text)' },
  Button: { shape: 'frame', color: 'var(--pin-button)' },
  List: { shape: 'frame', color: 'var(--pin-list)' },
  Image: { shape: 'frame', color: 'var(--pin-image)' },
  Clip: { shape: 'frame', color: 'var(--pin-clip)' }
}
export const COMPONENT_TYPES: readonly PinType[] = ['Text', 'Button', 'List', 'Image', 'Clip']
export const isComponentType = (t: PinType): boolean => COMPONENT_TYPES.includes(t)

export type Defs = ReadonlyMap<string, NodeDef>
type Pins = ReturnType<typeof resolvePins>
const pinCache = new WeakMap<object, { vars: unknown; defs: Defs; pins: Pins }>()

/** Effective pins of a node (typeFrom and dynamic outputs applied), cached per node data object. Undefined for a kind no pack defines. */
export function nodePins(defs: Defs, node: Pick<FlowNode, 'data'>, vars: Graph['variables']): Pins | undefined {
  const def = defs.get(node.data.kind)
  if (!def) return undefined
  const hit = pinCache.get(node.data)
  if (hit && hit.vars === vars && hit.defs === defs) return hit.pins
  const pins = resolvePins(def, node.data, vars)
  pinCache.set(node.data, { vars, defs, pins })
  return pins
}

// ---- connection rules ---------------------------------------------------------------------------------------------------------------

type Link = Parameters<Rule<FlowNode>>[0]
type Ctx = Parameters<Rule<FlowNode>>[1]

/**
 * The connection rule of the canvas: Knotwork's `composeRules` over rules that read pin TYPES from the pack definitions (our handle ids are pin names,
 * `<pin>-in` / `<pin>-out`, so Knotwork's kind-from-handle builders cannot see types). In order: both pins exist (an unknown pack node has none),
 * pins match (Exec only to Exec, data by the Spec's `pinCompat`: `same` and `coerce` pass), no self link, an Exec output and any data input take one
 * wire, and no Exec loop. Returns the reason a wire is refused, or null.
 */
export function connectionRule(defs: Defs, vars: () => Graph['variables']) {
  const pinAt = (ctx: Ctx, id: string, handle: string | null | undefined, side: 'inputs' | 'outputs'): ResolvedPin | 'unknown' | undefined => {
    const n = ctx.node(id)
    const pins = n && nodePins(defs, n, vars())
    if (!pins) return n ? 'unknown' : undefined
    return pins[side].find((p) => p.name === pinName(handle))
  }
  const ends = (l: Link, ctx: Ctx) => ({ a: pinAt(ctx, l.source, l.sourceHandle, 'outputs'), b: pinAt(ctx, l.target, l.targetHandle, 'inputs') })
  const known: Rule<FlowNode> = (l, ctx) => {
    const { a, b } = ends(l, ctx)
    if (a === 'unknown' || b === 'unknown') return 'Unknown pack node: its pins are not known'
    return a && b ? null : 'No such pin'
  }
  const matches: Rule<FlowNode> = (l, ctx) => {
    const { a, b } = ends(l, ctx)
    if (typeof a !== 'object' || typeof b !== 'object') return null
    if ((a.type === 'Exec') !== (b.type === 'Exec')) return 'Exec pins connect only to Exec pins'
    if (a.type === 'Exec') return null
    return pinCompat(a.type, b.type) === 'none' ? `${a.type} cannot connect to ${b.type} (use a To String / To Number node)` : null
  }
  const usedOnce: Rule<FlowNode> = (l, ctx) => {
    const { a, b } = ends(l, ctx)
    if (typeof a !== 'object' || typeof b !== 'object') return null
    if (a.type === 'Exec' && outgoing(ctx.edges, l.source).some((e) => e.sourceHandle === l.sourceHandle)) return 'This exec output already has a wire (use Sequence for several)'
    if (b.type !== 'Exec' && incoming(ctx.edges, l.target).some((e) => e.targetHandle === l.targetHandle)) return 'This input already has a wire'
    return null
  }
  const noExecLoop: Rule<FlowNode> = (l, ctx) => {
    const { a } = ends(l, ctx)
    if (typeof a !== 'object' || a.type !== 'Exec') return null
    // does the target already lead (over Exec wires) to the source?
    const seen = new Set<string>()
    const stack = [l.target]
    while (stack.length) {
      const id = stack.pop()!
      if (id === l.source) return 'Would create a loop (use For Each for loops)'
      if (seen.has(id)) continue
      seen.add(id)
      for (const e of outgoing(ctx.edges, id)) {
        const p = pinAt(ctx, e.source, e.sourceHandle, 'outputs')
        if (typeof p === 'object' && p.type === 'Exec') stack.push(e.target)
      }
    }
    return null
  }
  return composeRules<FlowNode>(known, matches, noSelfLink(), usedOnce, noExecLoop)
}

// ---- spawn menu ---------------------------------------------------------------------------------------------------------------------

const CATEGORY_ORDER = ['Events', 'Flow', 'Variables', 'Logic', 'Data', 'Components', 'List', 'Game', 'Inventory', 'Animation', 'Debug', 'Editor-only']
export const categoryVar = (category: string): string => `var(--cat-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}, var(--cat-other))`

export function categoriesOf(defs: Defs): { id: string; label: string }[] {
  const all = [...new Set([...defs.values()].map((d) => d.category))]
  const rank = (c: string): number => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length)
  return all.sort((x, y) => rank(x) - rank(y) || x.localeCompare(y)).map((id) => ({ id, label: id }))
}

/** Spawn definitions: Knotwork's `kind` is the full kind id; a pin id is `<PinType>:<pin name>` so `spawnOptions` can match the dragged pin's type. */
export function spawnDefs(defs: Defs): SpawnDef[] {
  return [...defs].map(([kind, d]) => ({
    kind,
    category: d.category,
    title: d.title,
    keywords: [d.kind, d.category],
    pins: [...d.inputs.map((p) => ({ id: `${p.type}:${p.name}`, side: 'in' as const })), ...d.outputs.map((p) => ({ id: `${p.type}:${p.name}`, side: 'out' as const }))]
  }))
}

export interface SpawnFromPin {
  nodeId: string
  /** The dragged pin's handle id on its node (`then-out`). */
  handle: string
  /** `source`: an output pin was dragged, `target`: an input pin. */
  type: 'source' | 'target'
}

/**
 * What the menu offers: every node type with no wire, else the types having a pin the dragged pin can connect to (same type, as Knotwork matches),
 * each tried against the real rule. `option.pin` is `<PinType>:<pin name>`.
 */
export function spawnFor(o: { defs: Defs; spawn: SpawnDef[]; nodes: FlowNode[]; edges: FlowEdge[]; vars: Graph['variables']; from: SpawnFromPin | null }): SpawnOption<SpawnDef>[] {
  const rule = connectionRule(o.defs, () => o.vars)
  const fromNode = o.from && o.nodes.find((n) => n.id === o.from!.nodeId)
  const fromPin = o.from && fromNode && nodePins(o.defs, fromNode, o.vars)?.[o.from.type === 'source' ? 'outputs' : 'inputs'].find((p) => p.name === pinName(o.from!.handle))
  if (o.from && !fromPin) return []
  const options = spawnOptions({
    defs: o.spawn,
    order: CATEGORY_ORDER,
    from: o.from && fromPin ? { nodeId: o.from.nodeId, handleId: `${fromPin.type}-${o.from.type === 'source' ? 'out' : 'in'}`, handleType: o.from.type } : null,
    refuse: (l, def) => {
      const fresh = (handle: string | null | undefined, side: 'in' | 'out') => `${pinField(handle) ?? ''}-${side}`
      const link = o.from!.type === 'source'
        ? { source: o.from!.nodeId, sourceHandle: o.from!.handle, target: SPAWN_NEW, targetHandle: fresh(l.targetHandle, 'in') }
        : { source: SPAWN_NEW, sourceHandle: fresh(l.sourceHandle, 'out'), target: o.from!.nodeId, targetHandle: o.from!.handle }
      const extra = { id: SPAWN_NEW, type: 'inkwell', position: { x: 0, y: 0 }, data: { id: SPAWN_NEW, kind: def.kind, fields: {}, pos: { x: 0, y: 0 } } } as FlowNode
      return rule(o.nodes, o.edges, link, extra)
    }
  })
  // `Branch · In` only where the node has several pins of that type; otherwise the plain title
  const same = new Map(o.spawn.map((d) => [d.kind, d.pins]))
  return options.map((x) => {
    const pins = same.get(x.def.kind) ?? []
    const mine = pins.find((p) => p.id === x.pin)
    return mine && pins.filter((p) => p.side === mine.side && p.id.split(':')[0] === mine.id.split(':')[0]).length === 1 ? { ...x, label: x.def.title } : x
  })
}

/** The wire a picked spawn option makes, or undefined (no dragged pin). */
export function spawnWire(from: SpawnFromPin | null, newId: string, option: Pick<SpawnOption<SpawnDef>, 'pin'>): { from: { node: string; pin: string }; to: { node: string; pin: string } } | undefined {
  const pin = pinField(option.pin)
  if (!from || !pin) return undefined
  return from.type === 'source'
    ? { from: { node: from.nodeId, pin: pinName(from.handle) }, to: { node: newId, pin } }
    : { from: { node: newId, pin }, to: { node: from.nodeId, pin: pinName(from.handle) } }
}

// ---- fields -------------------------------------------------------------------------------------------------------------------------

export type FieldKind = 'enum' | 'string' | 'text' | 'number' | 'bool' | 'layer' | 'variable' | 'params'
export interface FieldRow {
  /** Key in `node.fields`: a pack field, or the pin name of an unwired input pin. */
  key: string
  label: string
  kind: FieldKind
  value: unknown
  options?: string[]
  /** `layer` rows: the pin type, for the layer filter. */
  pinType?: PinType
  /** A schema `pattern` the value should match (identifiers). */
  pattern?: string
}

interface Schema { type?: string; enum?: unknown[]; default?: unknown; pattern?: string; format?: string }

/**
 * The inline editors of a node: its pack fields (enum, string, number, bool; `variable` picks a graph variable; `params` is the On Widget Call
 * parameter list) and one row per UNWIRED data input pin (a component-typed pin shows the layer picker and stores the layer id in `fields[<pin>]`;
 * other pins store a literal in `fields[<pin>]`, which codegen uses before the pack default). `wired` = input pins with a wire.
 */
export function fieldRows(def: NodeDef, node: Pick<FlowNode, 'data'>, pins: Pins, wired: ReadonlySet<string>): FieldRow[] {
  const f = node.data.fields
  const rows: FieldRow[] = []
  const inputNames = new Set(def.inputs.map((p) => p.name))
  for (const [key, raw] of Object.entries(def.fields)) {
    if (inputNames.has(key)) continue
    const s = (raw ?? {}) as Schema & { items?: unknown }
    const value = f[key] ?? s.default
    if (s.type === 'array') rows.push({ key, label: key, kind: 'params', value: Array.isArray(f[key]) ? f[key] : [] })
    else if (Array.isArray(s.enum)) rows.push({ key, label: key, kind: 'enum', value, options: s.enum.map(String) })
    else if (key === 'variable') rows.push({ key, label: key, kind: 'variable', value })
    else if (s.type === 'number' || s.type === 'integer') rows.push({ key, label: key, kind: 'number', value })
    else if (s.type === 'boolean') rows.push({ key, label: key, kind: 'bool', value })
    else rows.push({ key, label: key, kind: s.format === 'multiline' || (key === 'text' && def.extra && (def.extra as { editorOnly?: boolean }).editorOnly) ? 'text' : 'string', value, ...(s.pattern ? { pattern: s.pattern } : {}) })
  }
  for (const p of pins.inputs) {
    if (p.type === 'Exec' || wired.has(p.name)) continue
    const label = def.inputs.find((i) => i.name === p.name) as { label?: string } | undefined
    const base = { key: p.name, label: label?.label ?? p.name, value: f[p.name] }
    if (isComponentType(p.type)) rows.push({ ...base, kind: 'layer', pinType: p.type })
    else if (p.type === 'String') rows.push({ ...base, kind: 'string' })
    else if (p.type === 'Number') rows.push({ ...base, kind: 'number' })
    else if (p.type === 'Bool') rows.push({ ...base, kind: 'bool' })
  }
  return rows
}

/** A field value as the editor shows it: the node's own value, else the pack default of the pin (so an empty box shows what codegen will use). */
export const pinDefault = (def: NodeDef, name: string): unknown => (def.inputs.find((p) => p.name === name) as { default?: unknown } | undefined)?.default

// ---- layers -------------------------------------------------------------------------------------------------------------------------

export interface LayerOption {
  id: string
  /** The instance name the codegen uses: the overlay's, else the layer name. */
  label: string
  type: string
}

/** The SWF's layers (root excluded) by instance name, sorted. */
export function layerOptions(ir: Pick<Swf, 'nodes' | 'root'>, overlay: OverlayDoc | undefined): LayerOption[] {
  return Object.values(ir.nodes)
    .filter((n) => n.id !== ir.root)
    .map((n) => ({ id: n.id, label: ((overlay?.nodes?.[n.id] as { instanceName?: string } | undefined)?.instanceName) || n.name, type: n.type }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** What a pin lists in the layer picker: a Text pin text layers, an Image pin image layers, the other component pins every layer. */
export const layerChoices = (layers: readonly LayerOption[], pinType?: PinType): LayerOption[] =>
  layers.filter((l) => (pinType === 'Text' ? l.type === 'text' : pinType === 'Image' ? l.type === 'image' : true))

/** The first component-typed pin's layer id of a node: the component a graph node refers to (for the one selection model). */
export function nodeTarget(def: NodeDef | undefined, node: Pick<FlowNode, 'data'>): string | undefined {
  const pin = def?.inputs.find((p) => isComponentType(p.type))
  const v = pin && node.data.fields[pin.name]
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** Entry (event) nodes of a graph for the event jump list. */
export function eventNodes(defs: Defs, nodes: FlowNode[]): { id: string; title: string; detail: string }[] {
  return nodes.flatMap((n) => {
    const d = defs.get(n.data.kind)
    if (!d || (d.extra as { entry?: boolean } | undefined)?.entry !== true) return []
    const name = nodeName(n.data, d)
    return [{ id: n.id, title: d.title, detail: name }]
  })
}
