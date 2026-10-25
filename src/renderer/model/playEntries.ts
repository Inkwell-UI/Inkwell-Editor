import type { Graph } from '@inkwell-ui/spec'

/** An On Widget Call entry the Play panel can fire: the method name and its typed parameters (what Papyrus would call in game). */
export interface PlayParam {
  name: string
  type: 'String' | 'Number' | 'Bool'
}
export interface PlayEntry {
  /** `<graphId>/<nodeId>` */
  key: string
  graphId: string
  graphName: string
  nodeId: string
  name: string
  params: PlayParam[]
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const isCall = (kind: string): boolean => /^[^/]+\/OnWidgetCall@\d+$/.test(kind)

/** Every On Widget Call of the graphs, in graph and node order. An entry whose name or parameters codegen would refuse is left out. */
export function playEntries(graphs: readonly Pick<Graph, 'id' | 'name' | 'nodes'>[]): PlayEntry[] {
  return graphs.flatMap((g) =>
    g.nodes.flatMap((n) => {
      if (!isCall(n.kind)) return []
      const name = n.fields['name']
      const raw = n.fields['params']
      const list = Array.isArray(raw) ? raw : []
      if (typeof name !== 'string' || !IDENT.test(name)) return []
      const params = list.map((p: { name?: unknown; type?: unknown }) => ({ name: p?.name, type: p?.type }))
      if (!params.every((p): p is PlayParam => typeof p.name === 'string' && IDENT.test(p.name) && (p.type === 'String' || p.type === 'Number' || p.type === 'Bool'))) return []
      return [{ key: `${g.id}/${n.id}`, graphId: g.id, graphName: g.name, nodeId: n.id, name, params }]
    })
  )
}

/** The values as the generated clip method receives them: one string array, like Papyrus' `UI.InvokeStringA` (`true`/`false`, numbers in plain notation). */
export function callArgs(params: readonly PlayParam[], values: Readonly<Record<string, string | boolean>>): string[] {
  return params.map((p) => {
    const v = values[p.name]
    if (p.type === 'Bool') return v === true || v === 'true' ? 'true' : 'false'
    if (p.type === 'Number') return String(Number(v) || 0)
    return typeof v === 'string' ? v : ''
  })
}
