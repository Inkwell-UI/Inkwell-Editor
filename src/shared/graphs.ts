import { SPEC_VERSION, type Graph, type NodeDef, type PackManifest } from '@inkwell-ui/spec'

/** Graph ids are file names (`swfs/<name>/graphs/<id>.json`): plain characters only, so an id can never escape the folder. */
export const GRAPH_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/
export const isGraphId = (s: unknown): s is string => typeof s === 'string' && GRAPH_ID.test(s) && !s.endsWith('.')

export interface GraphSummary {
  id: string
  name: string
  scope: Graph['scope']
  nodes: number
}
export const summarize = (g: Graph): GraphSummary => ({ id: g.id, name: g.name, scope: g.scope, nodes: g.nodes.length })

export type GraphResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string }

/** The generated AS2 class of one graph (the AS2 split view): source plus the source map (generated line, 1-based, to graph node id). */
export interface GraphAs2 {
  source: string
  /** Lines of scaffolding have no entry. */
  lines: Record<string, string>
}

/** A file-safe graph id from a name (`Show Title` -> `show-title`), unique among `taken`. */
export function newGraphId(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'graph'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

export function emptyGraph(id: string, name: string, scope: Graph['scope']): Graph {
  return { specVersion: SPEC_VERSION, id, name, scope, nodes: [], edges: [], variables: [], comments: [], groups: [] }
}

/**
 * What `+ Graph` creates: an empty graph with one unconnected On Load, so there is an event to wire from (like a new script's `Start`). On Load has no required pin and works
 * in every target, so a new graph is lint-clean; On Widget Call (it would replace a HUD widget's built-in Show/SetTexts/Hide) and On Click (needs a target) are never seeded.
 */
export function newGraph(id: string, name: string, scope: Graph['scope']): Graph {
  return { ...emptyGraph(id, name, scope), nodes: [{ id: crypto.randomUUID(), kind: 'core/OnLoad@1', fields: {}, pos: { x: 0, y: 0 } }] }
}

/** The `name` of a node (handler or message name): the field when the node has it, else the pack's default. The editor shows that default in the field without storing it, so an untouched On Widget Call is "Show" without having a `name` field. */
export function nodeName(n: { fields: Record<string, unknown> }, def: NodeDef | undefined): string {
  const v = n.fields['name']
  if (typeof v === 'string') return v
  const d = (def?.fields['name'] as { default?: unknown } | undefined)?.default
  return typeof d === 'string' ? d : ''
}

/** One loaded pack: its manifest and node definitions (the renderer only ever sees data, never code). */
export interface LoadedPack {
  manifest: PackManifest
  nodes: NodeDef[]
  /** Library functions (`functions/<id>.json`, function graphs); their ids are the file names, call them as `<packId>/<id>`. */
  functions?: Graph[]
  /** Where the pack came from, set by the session: the bundled `core` pack, the project's own `libraries/` folder (editable, kept with the project) or a downloaded pack (`packs-cache`, replaced by an update). */
  origin?: 'core' | 'library' | 'installed'
  /** The folder the pack was loaded from (an edited library function is written back there). */
  dir?: string
}
/** `problems` are files that could not be read or failed the schema; the rest of the pack still loads. */
export interface PackSet {
  packs: LoadedPack[]
  problems: string[]
}

/** The id a Call Function node uses for a function of a pack: `<packId>/<functionId>` (a local function is just its graph id). */
export const libraryFunctionId = (packId: string, fnId: string): string => `${packId}/${fnId}`

/** Node kind id as stored in graph files: `packId/kind@major`. */
export const kindId = (packId: string, def: Pick<NodeDef, 'kind' | 'major'>): string => `${packId}/${def.kind}@${def.major}`

export const defIndex = (set: PackSet): Map<string, NodeDef> =>
  new Map(set.packs.flatMap((p) => p.nodes.map((d) => [kindId(p.manifest.id, d), d] as const)))

/** Overlay `scripts` (graph ids) of one Figma node. */
export const scriptsOf = (overlayEntry: unknown): string[] => {
  const s = (overlayEntry as { scripts?: unknown } | undefined)?.scripts
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string') : []
}
