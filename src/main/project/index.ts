import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { migrate, SPEC_VERSION, type Graph, type MenuSettings } from '@inkwell-ui/spec'
import { z } from 'zod'
import { cleanModId } from '../../shared/modId'
import { readGraphs, writeGraphLocked } from './graphFiles'
import { readMenuSettings, writeMenuLocked } from './menuFile'

// project.json is editor-owned. Unknown keys are kept (looseObject) so they survive load -> save.
export const ProjectMetaSchema = z.looseObject({
  name: z.string(),
  /** Letters and digits only (shared/modId.ts): every load and save cleans it, so a project never keeps an id the deploy would refuse. */
  modId: z.string().transform(cleanModId),
  version: z.string(),
  author: z.string().optional(),
  strictMode: z.boolean().optional(),
  /** How images reach the game: compiled into the SWF (default) or DDS textures loaded at runtime through img:// (docs/images.md). */
  imageMode: z.enum(['embedded', 'dds']).optional(),
  deploy: z.looseObject({
    preset: z.enum(['mo2', 'vortex', 'folder']),
    path: z.string()
  })
})
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>

/** ir.json / overlay.json are owned by inkwell-spec: opaque JSON objects here. */
const OpaqueObject = z.record(z.string(), z.unknown())
export type Opaque = z.infer<typeof OpaqueObject>

export interface Project {
  meta: ProjectMeta
  /** `graphs`: the SWF's `graphs/<id>.json` files by graph id (docs/graphs.md). */
  /** `menu`: `swfs/<name>/menu.json` of a custom menu (absent = none on disk); `menuError`: the file exists but could not be read, so it is never written back. */
  swfs: Record<string, { ir: Opaque; overlay: Opaque; graphs?: Record<string, Graph>; menu?: MenuSettings; menuError?: string }>
  /** Raw text of packs.lock (format not defined yet); undefined if absent. */
  packsLock?: string
}

/** Sorted keys, 2-space indent, trailing newline. */
export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sort(x)]))
        : v
  return JSON.stringify(sort(value), null, 2) + '\n'
}

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))

const upgrade = (ir: unknown): unknown =>
  ir && typeof ir === 'object' && typeof (ir as { specVersion?: unknown }).specVersion === 'number' && (ir as { specVersion: number }).specVersion < SPEC_VERSION
    ? migrate(ir as { specVersion: number })
    : ir

export async function loadProject(dir: string): Promise<Project> {
  const meta = ProjectMetaSchema.parse(await readJson(join(dir, 'project.json')))
  const swfs: Project['swfs'] = {}
  const swfDir = join(dir, 'swfs')
  const entries = await readdir(swfDir, { withFileTypes: true }).catch(() => [])
  for (const e of entries.filter((e) => e.isDirectory())) {
    const menu = await readMenuSettings(dir, e.name)
    swfs[e.name] = {
      // Old projects open through the spec's migrations (specVersion is saved back as current).
      ir: OpaqueObject.parse(await readJson(join(swfDir, e.name, 'ir.json')).then(upgrade)),
      overlay: OpaqueObject.parse(await readJson(join(swfDir, e.name, 'overlay.json'))),
      graphs: Object.fromEntries((await readGraphs(dir, e.name)).graphs.map((g) => [g.id, g])),
      ...(menu.settings ? { menu: menu.settings } : {}),
      ...(menu.error ? { menuError: menu.error } : {})
    }
  }
  const packsLock = await readFile(join(dir, 'packs.lock'), 'utf8').catch(() => undefined)
  return packsLock === undefined ? { meta, swfs } : { meta, swfs, packsLock }
}

export async function saveProject(dir: string, project: Project): Promise<void> {
  const meta = ProjectMetaSchema.parse(project.meta)
  await Promise.all(['figma', 'shared'].map((d) => mkdir(join(dir, d), { recursive: true })))
  await writeFile(join(dir, 'project.json'), stableStringify(meta))
  for (const [name, swf] of Object.entries(project.swfs)) {
    const d = join(dir, 'swfs', name)
    await mkdir(d, { recursive: true })
    await writeFile(join(d, 'ir.json'), stableStringify(swf.ir))
    await writeFile(join(d, 'overlay.json'), stableStringify(swf.overlay))
    // menu.json is written only when the project holds one (and it was readable): a file the editor could not read survives
    if (swf.menu && !swf.menuError) await writeMenuLocked(dir, name, swf.menu)
    // graph files are written, never deleted here: a graph the editor could not read must survive. Unlocked: the build pipeline calls this inside `exclusive`.
    for (const g of Object.values(swf.graphs ?? {})) {
      const r = await writeGraphLocked(dir, name, g)
      if (!r.ok) throw new Error(r.error)
    }
  }
  // Owner decision: swf folders no longer in the project are deleted.
  const existing = await readdir(join(dir, 'swfs'), { withFileTypes: true }).catch(() => [])
  for (const e of existing.filter((e) => e.isDirectory() && !Object.hasOwn(project.swfs, e.name))) {
    await rm(join(dir, 'swfs', e.name), { recursive: true, force: true })
  }
  if (project.packsLock !== undefined) await writeFile(join(dir, 'packs.lock'), project.packsLock)
}
