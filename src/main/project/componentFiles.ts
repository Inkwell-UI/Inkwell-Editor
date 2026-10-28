import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Graph } from '@inkwell-ui/spec'
import type { GraphResult } from '../../shared/graphs'
import { graphText, parseGraph } from './graphFiles'
import { exclusive } from './lock'

/** The behaviour graphs of reusable components (blueprint graphs): `<project>/components/<slug>.json`, one per Figma component. They belong to the project, not to a SWF. */
export const COMPONENTS_DIR = 'components'

/** File name of a component's graph: its Figma id (`36:5`) with the characters a file name cannot hold replaced. */
export const componentSlug = (componentId: string): string => componentId.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'component'
const fileOf = (project: string, componentId: string): string => join(project, COMPONENTS_DIR, `${componentSlug(componentId)}.json`)

/** Every readable component graph, sorted by file name. Unreadable files are reported, never deleted. */
export async function readComponentGraphs(project: string): Promise<{ graphs: Graph[]; problems: string[] }> {
  const graphs: Graph[] = []
  const problems: string[] = []
  const names = (await readdir(join(project, COMPONENTS_DIR)).catch(() => [])).filter((n) => n.endsWith('.json')).sort()
  for (const n of names) {
    try {
      const g = parseGraph(await readFile(join(project, COMPONENTS_DIR, n), 'utf8'))
      if (g.scope === 'blueprint') graphs.push(g)
      else problems.push(`${COMPONENTS_DIR}/${n}: not a blueprint graph`)
    } catch (e) {
      problems.push(`${COMPONENTS_DIR}/${n}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { graphs, problems }
}

/** Validates and writes one component graph (a blueprint with its component id). */
export function writeComponentGraph(project: string, doc: unknown): Promise<GraphResult> {
  const parsed = Graph.safeParse(doc)
  if (!parsed.success) return Promise.resolve({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid graph' })
  const g = parsed.data
  if (g.scope !== 'blueprint' || !g.component) return Promise.resolve({ ok: false, error: 'Not a component graph.' })
  return exclusive(async (): Promise<GraphResult> => {
    try {
      await mkdir(join(project, COMPONENTS_DIR), { recursive: true })
      await writeFile(fileOf(project, g.component!), graphText(g))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

export const deleteComponentGraph = (project: string, componentId: string): Promise<GraphResult> =>
  exclusive(async (): Promise<GraphResult> => {
    try {
      await rm(fileOf(project, componentId), { force: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

export const componentGraphExists = (project: string, componentId: string): Promise<boolean> => readFile(fileOf(project, componentId)).then(() => true, () => false)
