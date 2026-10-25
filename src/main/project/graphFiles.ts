import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Graph, migrate, SPEC_VERSION } from '@inkwell-ui/spec'
import { isGraphId, type GraphResult } from '../../shared/graphs'
import { stableStringify } from './index'
import { exclusive } from './lock'

const SAFE_NAME = /^[A-Za-z0-9._-]+$/
const dirOf = (project: string, swf: string): string => {
  if (!SAFE_NAME.test(swf) || swf === '.' || swf === '..') throw new Error(`Invalid swf name "${swf}"`)
  return join(project, 'swfs', swf, 'graphs')
}
const fileOf = (project: string, swf: string, id: string): string => {
  if (!isGraphId(id)) throw new Error(`Invalid graph id "${id}"`)
  return join(dirOf(project, swf), `${id}.json`)
}

/** Parses graph text. Old files run through the spec's migrations; unknown keys at every level survive (the schema is loose). */
export function parseGraph(text: string): Graph {
  const raw: unknown = JSON.parse(text)
  const up = raw && typeof raw === 'object' && typeof (raw as { specVersion?: unknown }).specVersion === 'number' && (raw as { specVersion: number }).specVersion < SPEC_VERSION ? migrate(raw as { specVersion: number }) : raw
  return Graph.parse(up)
}

/** The bytes of a graph file: sorted keys, 2-space indent, trailing newline. Array order (nodes, edges) is data and kept. */
export const graphText = (g: Graph): string => stableStringify(g)

export async function readGraph(project: string, swf: string, id: string): Promise<GraphResult<{ graph: Graph }>> {
  try {
    const graph = parseGraph(await readFile(fileOf(project, swf, id), 'utf8'))
    return graph.id === id ? { ok: true, graph } : { ok: false, error: `graphs/${id}.json holds graph "${graph.id}"` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Every readable graph of a SWF, sorted by id. Unreadable files are reported, never deleted. */
export async function readGraphs(project: string, swf: string): Promise<{ graphs: Graph[]; problems: string[] }> {
  const graphs: Graph[] = []
  const problems: string[] = []
  const names = (await readdir(dirOf(project, swf)).catch(() => [])).filter((n) => n.endsWith('.json')).sort()
  for (const n of names) {
    const r = await readGraph(project, swf, n.slice(0, -5))
    if (r.ok) graphs.push(r.graph)
    else problems.push(`${swf}/graphs/${n}: ${r.error}`)
  }
  return { graphs, problems }
}

/** Validates (schema, id) and writes one graph. Same lock as the overlay writes. */
export function writeGraph(project: string, swf: string, doc: unknown): Promise<GraphResult> {
  const parsed = Graph.safeParse(doc)
  if (!parsed.success) return Promise.resolve({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid graph' })
  const g = parsed.data
  return exclusive(async (): Promise<GraphResult> => {
    try {
      const file = fileOf(project, swf, g.id)
      await mkdir(dirOf(project, swf), { recursive: true })
      await writeFile(file, graphText(g))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

export function deleteGraph(project: string, swf: string, id: string): Promise<GraphResult> {
  return exclusive(async (): Promise<GraphResult> => {
    try {
      await rm(fileOf(project, swf, id), { force: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
