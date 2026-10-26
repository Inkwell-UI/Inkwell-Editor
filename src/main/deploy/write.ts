import { mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { join } from 'node:path'
import { sha256 } from '../vanilla/bsa'
import { safeJoin } from './plan'

export const MANIFEST_NAME = '.inkwell-deploy.json'

export interface Manifest {
  version: 1
  modId: string
  deployedAt: string
  /** Relative path (forward slashes) -> what was written and for which SWF. */
  files: Record<string, { sha256: string; swf: string }>
}

export async function readManifest(root: string): Promise<Manifest | undefined> {
  try {
    const m = JSON.parse(await readFile(join(root, MANIFEST_NAME), 'utf8')) as Manifest
    return m && m.version === 1 && m.files && typeof m.files === 'object' ? m : undefined
  } catch {
    return undefined
  }
}

/**
 * Files a previous deploy wrote that this one does not produce. `scope`: the SWFs this deploy covers (undefined = all of them); an "active SWF only"
 * deploy never retires another SWF's files.
 */
export function staleFiles(old: Manifest | undefined, next: Iterable<string>, scope?: Set<string>): string[] {
  const keep = new Set([...next].map((r) => r.toLowerCase()))
  return Object.entries(old?.files ?? {})
    .filter(([rel, e]) => !keep.has(rel.toLowerCase()) && (!scope || scope.has(e.swf)))
    .map(([rel]) => rel)
}

/** Temp file in the same folder, then rename: a reader never sees a half-written file. */
export async function writeAtomic(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.inkwell-tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

export interface WriteOutcome {
  written: string[]
  unchanged: string[]
  removed: string[]
  /** Stale files kept because they were changed after Inkwell wrote them (or could not be removed). */
  kept: string[]
  /** `createOnly` files that already existed: left alone, never in the manifest. */
  preserved: string[]
}

/**
 * Writes `files` under `root` and retires what the previous manifest lists but this deploy no longer produces. Only files named in the old manifest are ever
 * deleted (and only if still byte-identical to what Inkwell wrote); every path goes through `safeJoin`; the new manifest is written last.
 */
export async function writeDeploy(o: { root: string; modId: string; files: Map<string, { data: Buffer; swf: string; createOnly?: boolean }>; scope?: Set<string> }): Promise<WriteOutcome> {
  const out: WriteOutcome = { written: [], unchanged: [], removed: [], kept: [], preserved: [] }
  const old = await readManifest(o.root)
  for (const rel of o.files.keys()) safeJoin(o.root, rel) // validate everything before the first write
  const next: Manifest['files'] = {}
  for (const [rel, f] of o.files) {
    const p = safeJoin(o.root, rel)
    if (f.createOnly) { // the user's file once it exists (a commented INI the user edited); not tracked, so it is never retired either
      if (await readFile(p).then(() => true, () => false)) out.preserved.push(rel)
      else {
        await writeAtomic(p, f.data)
        out.written.push(rel)
      }
      continue
    }
    const hash = sha256(f.data)
    next[rel] = { sha256: hash, swf: f.swf }
    const cur = await readFile(p).then((b) => sha256(b), () => undefined)
    if (cur === hash) out.unchanged.push(rel)
    else {
      await writeAtomic(p, f.data)
      out.written.push(rel)
    }
  }
  const stale = staleFiles(old, o.files.keys(), o.scope)
  for (const rel of stale) {
    let p: string
    try {
      p = safeJoin(o.root, rel) // a tampered manifest cannot reach outside the folder
    } catch {
      out.kept.push(rel)
      continue
    }
    const cur = await readFile(p).then((b) => sha256(b), () => undefined)
    if (cur === undefined) continue // already gone
    if (cur !== old!.files[rel]!.sha256) {
      out.kept.push(rel)
      next[rel] = old!.files[rel]! // still ours to track
      continue
    }
    await unlink(p)
    out.removed.push(rel)
    for (let d = dirname(p); d.toLowerCase() !== resolve(o.root).toLowerCase(); d = dirname(d)) {
      if ((await readdir(d).catch(() => ['x'])).length) break
      await rmdir(d).catch(() => undefined)
    }
  }
  // entries of SWFs outside this deploy's scope stay in the manifest
  for (const [rel, e] of Object.entries(old?.files ?? {})) if (!(rel in next) && o.scope && !o.scope.has(e.swf) && !stale.includes(rel)) next[rel] = e
  const manifest: Manifest = { version: 1, modId: o.modId, deployedAt: new Date().toISOString(), files: Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1))) }
  await writeAtomic(join(o.root, MANIFEST_NAME), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
  return out
}
