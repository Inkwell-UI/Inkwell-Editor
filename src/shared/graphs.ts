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

/** One loaded pack: its manifest and node definitions (the renderer only ever sees data, never code). */
export interface LoadedPack {
  manifest: PackManifest
  nodes: NodeDef[]
}
/** `problems` are files that could not be read or failed the schema; the rest of the pack still loads. */
export interface PackSet {
  packs: LoadedPack[]
  problems: string[]
}

/** Node kind id as stored in graph files: `packId/kind@major`. */
export const kindId = (packId: string, def: Pick<NodeDef, 'kind' | 'major'>): string => `${packId}/${def.kind}@${def.major}`

export const defIndex = (set: PackSet): Map<string, NodeDef> =>
  new Map(set.packs.flatMap((p) => p.nodes.map((d) => [kindId(p.manifest.id, d), d] as const)))

/** Overlay `scripts` (graph ids) of one Figma node. */
export const scriptsOf = (overlayEntry: unknown): string[] => {
  const s = (overlayEntry as { scripts?: unknown } | undefined)?.scripts
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string') : []
}
