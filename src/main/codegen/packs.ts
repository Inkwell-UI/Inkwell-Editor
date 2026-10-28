import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { Graph, NodeDef } from '@inkwell-ui/spec'
import { kindId, libraryFunctionId } from '../../shared/graphs'
import { loadPack } from '../packs'

/** What codegen needs from packs: node definitions and AS2 template text, both by `packId/kind@major`. */
export interface CodegenPacks {
  defs: ReadonlyMap<string, NodeDef>
  templates: ReadonlyMap<string, string>
  /** Library functions by `<packId>/<functionId>`; the graph's `id` is that qualified id (class and map file names come from it). */
  functions?: ReadonlyMap<string, Graph>
}

/** Loads pack folders with their template files (CRLF normalised). A template that cannot be read is a problem and that node cannot be compiled. Never throws. */
export async function loadCodegenPacks(dirs: readonly string[]): Promise<{ packs: CodegenPacks; problems: string[] }> {
  const defs = new Map<string, NodeDef>()
  const templates = new Map<string, string>()
  const functions = new Map<string, Graph>()
  const problems: string[] = []
  for (const dir of dirs) {
    const r = await loadPack(dir)
    problems.push(...r.problems)
    if (!r.pack) continue
    for (const g of r.pack.functions ?? []) {
      const id = libraryFunctionId(r.pack.manifest.id, g.id)
      if (!functions.has(id)) functions.set(id, { ...g, id })
    }
    for (const d of r.pack.nodes) {
      const id = kindId(r.pack.manifest.id, d)
      if (defs.has(id)) continue // the first pack wins
      defs.set(id, d)
      if (!d.as2Template) continue
      const file = resolve(dir, d.as2Template)
      if (!file.startsWith(resolve(dir) + sep)) problems.push(`${id}: template path "${d.as2Template}" leaves the pack folder`)
      else {
        try {
          templates.set(id, (await readFile(file, 'utf8')).replace(/\r\n/g, '\n'))
        } catch (e) {
          problems.push(`${id}: ${d.as2Template}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  }
  return { packs: { defs, templates, functions }, problems }
}
