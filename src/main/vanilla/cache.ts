import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { extractEntry, openBsa, sha256, sha256File } from './bsa'

// Bethesda's vanilla SWFs are never shipped: they are extracted from the user's own Skyrim - Interface.bsa into
// <userData>/vanilla-cache/<archiveHash>/ (outside every project and the repo). The index of their hashes lets Deploy refuse unmodified vanilla files.

export interface VanillaIndex {
  archive: string
  archiveHash: string
  builtAt: string
  entries: { path: string; size: number; sha256: string }[]
}

export const vanillaCacheRoot = (userData: string): string => join(userData, 'vanilla-cache')

export interface CacheStatus {
  built: boolean
  /** sha256 of the archive that was looked up (only when a BSA path was given). */
  archiveHash?: string
  dir?: string
  entries?: number
  bytes?: number
}

const readIndex = (dir: string): Promise<VanillaIndex | undefined> =>
  readFile(join(dir, 'index.json'), 'utf8').then((t) => JSON.parse(t) as VanillaIndex, () => undefined)

/** Extracts every `.swf` of the archive into `<cacheRoot>/<archiveHash>/`, then writes `index.json` last (a cache without an index counts as not built). */
export async function buildVanillaCache(o: { bsaPath: string; cacheRoot: string }): Promise<{ archiveHash: string; dir: string; entries: number; bytes: number }> {
  const archiveHash = await sha256File(o.bsaPath)
  const dir = join(o.cacheRoot, archiveHash)
  const bsa = openBsa(o.bsaPath)
  const entries: VanillaIndex['entries'] = []
  let bytes = 0
  for (const e of bsa.entries) {
    if (!e.name.toLowerCase().endsWith('.swf')) continue
    const rel = `${e.folder}/${e.name}`.toLowerCase()
    const dest = resolve(dir, ...rel.split('/'))
    if (!dest.startsWith(resolve(dir) + sep)) throw new Error(`Archive entry escapes the cache folder: ${rel}`)
    const data = extractEntry(bsa, e)
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, data)
    entries.push({ path: rel, size: data.length, sha256: sha256(data) })
    bytes += data.length
  }
  const index: VanillaIndex = { archive: o.bsaPath, archiveHash, builtAt: new Date().toISOString(), entries }
  await writeFile(join(dir, 'index.json.tmp'), JSON.stringify(index, null, 2) + '\n')
  await rename(join(dir, 'index.json.tmp'), join(dir, 'index.json'))
  return { archiveHash, dir, entries: entries.length, bytes }
}

/** Is the cache for this archive built? Without a BSA path, reports any built cache (the newest folder). */
export async function vanillaCacheStatus(o: { bsaPath?: string; cacheRoot: string }): Promise<CacheStatus> {
  const hash = o.bsaPath ? await sha256File(o.bsaPath).catch(() => undefined) : undefined
  const dirs = hash ? [hash] : await readdir(o.cacheRoot).catch(() => [] as string[])
  for (const d of dirs) {
    const idx = await readIndex(join(o.cacheRoot, d))
    if (idx) return { built: true, ...(hash ? { archiveHash: hash } : {}), dir: join(o.cacheRoot, d), entries: idx.entries.length, bytes: idx.entries.reduce((n, e) => n + e.size, 0) }
  }
  return { built: false, ...(hash ? { archiveHash: hash } : {}) }
}

/** The hashes of all cached vanilla files (every archive version that was ever cached). */
export async function loadVanillaHashes(cacheRoot: string): Promise<Set<string>> {
  const out = new Set<string>()
  for (const d of await readdir(cacheRoot).catch(() => [] as string[])) for (const e of (await readIndex(join(cacheRoot, d)))?.entries ?? []) out.add(e.sha256)
  return out
}

/** True when `bytes` is byte-identical to a vanilla file in the cache index. Deploy refuses these. */
export const isUnmodifiedVanilla = (bytes: Uint8Array, hashes: ReadonlySet<string>): boolean => hashes.size > 0 && hashes.has(sha256(bytes))

/** True when `child` is inside `parent` (case-insensitive, Windows paths). */
export const isInside = (child: string, parent: string): boolean => {
  const c = resolve(child).toLowerCase()
  const p = resolve(parent).toLowerCase()
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep)
}
