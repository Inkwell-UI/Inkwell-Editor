import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NodeDef, PackManifest } from '@inkwell-ui/spec'
import type { LoadedPack, PackSet } from '../../shared/graphs'

/**
 * Reads a pack folder: `manifest.json` plus `nodes/*.json` (one NodeDef each), validated with the Spec schemas. Packs are data only; nothing in a
 * pack is ever executed. A node file that fails to read or validate is listed in `problems` and skipped, the rest of the pack still loads.
 * shortcut: `compatible.tool` is kept but not evaluated against the editor version; evaluate it when downloaded packs and packs.lock arrive (0.5).
 */
export async function loadPack(dir: string): Promise<{ pack?: LoadedPack; problems: string[] }> {
  const problems: string[] = []
  let manifest: PackManifest
  try {
    manifest = PackManifest.parse(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')))
  } catch (e) {
    return { problems: [`${dir}: manifest.json: ${e instanceof Error ? e.message : String(e)}`] }
  }
  const nodes: NodeDef[] = []
  const seen = new Set<string>()
  const files = (await readdir(join(dir, 'nodes')).catch(() => [])).filter((f) => f.endsWith('.json')).sort()
  for (const f of files) {
    try {
      const def = NodeDef.parse(JSON.parse(await readFile(join(dir, 'nodes', f), 'utf8')))
      const id = `${def.kind}@${def.major}`
      if (seen.has(id)) problems.push(`${manifest.id}: nodes/${f}: duplicate node ${id}`)
      else (seen.add(id), nodes.push(def))
    } catch (e) {
      problems.push(`${manifest.id}: nodes/${f}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { pack: { manifest, nodes }, problems }
}

/** Loads several pack folders into one set (a pack id seen twice keeps the first). Never throws. */
export async function loadPacks(dirs: readonly string[]): Promise<PackSet> {
  const set: PackSet = { packs: [], problems: [] }
  for (const d of dirs) {
    const r = await loadPack(d)
    set.problems.push(...r.problems)
    if (!r.pack) continue
    if (set.packs.some((p) => p.manifest.id === r.pack!.manifest.id)) set.problems.push(`${d}: pack "${r.pack.manifest.id}" is already loaded`)
    else set.packs.push(r.pack)
  }
  return set
}

/** Folder of the bundled core pack: `INKWELL_CORE_PACK` overrides `<app>/resources/packs/core` (a snapshot of Inkwell-Core-Pack, copied in when it ships). */
export const corePackDir = (appPath: string, env: NodeJS.ProcessEnv = process.env): string => env['INKWELL_CORE_PACK'] || join(appPath, 'resources/packs/core')
