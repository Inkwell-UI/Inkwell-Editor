import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Node } from '@inkwell-ui/spec'
import { z } from 'zod'
import { componentSlug } from './componentFiles'
import { stableStringify } from './index'

/**
 * `figma/components/<slug>.json`: what each component kept on the Figma page away from the design is made of (the component's node and everything under it, by id). The plugin sends it with
 * the `swfs` message; it is kept here so the editor knows the components with Figma closed (Navigator, layer pickers, and later the compiler). Like the SWFs' `ir.json`, it is Figma's data:
 * rewritten whenever the plugin reports it, never edited by hand.
 */
export const COMPONENT_TREES_DIR = ['figma', 'components'] as const

export interface ComponentTreeFile {
  id: string
  name: string
  nodes: Record<string, Node>
}
const File = z.object({ id: z.string(), name: z.string(), nodes: z.record(z.string(), Node) })

export async function readComponentTrees(project: string): Promise<ComponentTreeFile[]> {
  const dir = join(project, ...COMPONENT_TREES_DIR)
  const out: ComponentTreeFile[] = []
  for (const n of (await readdir(dir).catch(() => [])).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const r = File.safeParse(JSON.parse(await readFile(join(dir, n), 'utf8')))
      if (r.success) out.push(r.data)
    } catch {
      // an unreadable file is skipped, never deleted: the next report from the plugin rewrites it
    }
  }
  return out
}

/** Makes the folder hold exactly `trees` (the plugin lists every component on the page): changed files are written, files of components that are gone are removed. */
export async function writeComponentTrees(project: string, trees: readonly ComponentTreeFile[]): Promise<void> {
  const dir = join(project, ...COMPONENT_TREES_DIR)
  await mkdir(dir, { recursive: true })
  const keep = new Set<string>()
  for (const t of trees) {
    const file = `${componentSlug(t.id)}.json`
    keep.add(file)
    const text = stableStringify(t)
    if ((await readFile(join(dir, file), 'utf8').catch(() => undefined)) !== text) await writeFile(join(dir, file), text)
  }
  for (const n of await readdir(dir).catch(() => [])) if (n.endsWith('.json') && !keep.has(n)) await rm(join(dir, n), { force: true })
}
