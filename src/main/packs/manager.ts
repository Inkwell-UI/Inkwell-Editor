import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { NodeDef, PackIndex, PackManifest, packAssetUrl, parsePacksLock, SPEC_VERSION, writePacksLock, type PackIndexEntry, type PackLockEntry, type PacksLock } from '@inkwell-ui/spec'
import { readZip } from '../deploy/zip'
import type { LockedPack, PackCandidate, PackResult, PacksState } from '../../shared/packs'

/**
 * Downloaded node packs (0.5, SPEC-CHANGES W1/W2): GitHub release assets (`pack.zip`, never the GitHub API), checked by SHA-256, pinned in
 * `packs.lock`, cached in `<project>/packs-cache/` (git-ignored) and loaded through the same `loadPack` as the bundled core pack. Packs are data:
 * nothing in a pack runs. The network is injected (`Fetch`) so tests never touch it.
 */
export type Fetch = (url: string, init?: { method?: string }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>

export const DEFAULT_INDEX_URL = 'https://raw.githubusercontent.com/Inkwell-UI/Inkwell-Packs-Index/main/index.json'
export const packCacheDir = (projectDir: string): string => join(projectDir, 'packs-cache')
const entryDir = (projectDir: string, e: { id: string; version: string }): string => join(packCacheDir(projectDir), `${e.id}@${e.version}`)
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const EMPTY: PacksLock = { specVersion: SPEC_VERSION, packs: [] }

/** `packs.lock` of the project: absent (or the pre-0.5 placeholder `packs: []`) = no packs; unreadable = `error`, and the file is never overwritten. */
export async function readLock(projectDir: string): Promise<{ lock: PacksLock; error?: string }> {
  const text = await readFile(join(projectDir, 'packs.lock'), 'utf8').catch(() => undefined)
  if (text === undefined || text.trim() === 'packs: []') return { lock: EMPTY }
  try {
    return { lock: parsePacksLock(text) }
  } catch (e) {
    return { lock: EMPTY, error: `packs.lock cannot be read (${message(e)}). Fix or delete it; the editor will not overwrite it.` }
  }
}

/** Which locked packs the cache holds exactly (the zip's SHA-256 equals the lockfile's) and the folders to load. Reads the disk only, never the network. */
export async function lockedPacks(projectDir: string, lock: PacksLock): Promise<{ locked: LockedPack[]; dirs: string[] }> {
  const locked: LockedPack[] = []
  const dirs: string[] = []
  for (const e of lock.packs) {
    const dir = entryDir(projectDir, e)
    const zip = await readFile(`${dir}.zip`).catch(() => undefined)
    const manifest = zip && (await readFile(join(dir, 'manifest.json')).catch(() => undefined))
    // shortcut: the extracted folder is trusted once its zip matches; re-extract on load if hand edits in packs-cache/ become a problem
    const state = !zip || !manifest ? 'missing' : sha256(zip) === e.sha256 ? 'ok' : 'mismatch'
    locked.push({ ...e, state })
    if (state === 'ok') dirs.push(dir)
  }
  return { locked, dirs }
}

/** `owner/name` and an optional version from what a user pastes: `owner/name`, `https://github.com/owner/name[.git]`, `.../releases/tag/v1.2.3`, or a release asset URL. */
export function parseGitHubRef(input: string): { repo: string; version?: string } | undefined {
  const m = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/releases\/(?:tag|download)\/v(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)(?:\/.*)?|\/.*)?\/?$/.exec(input.trim())
  return m ? { repo: `${m[1]}/${m[2]}`, ...(m[3] ? { version: m[3] } : {}) } : undefined
}

/** The repo of a lock entry's source URL. */
const repoOf = (source: string): string | undefined => parseGitHubRef(source)?.repo

const cmp = (a: string, b: string): number => {
  const n = (v: string): number[] => v.split(/[-+]/)[0]!.split('.').map(Number)
  const [x, y] = [n(a), n(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!
  return 0
}

async function download(fetch: Fetch, url: string): Promise<Buffer> {
  let res: Awaited<ReturnType<Fetch>>
  try {
    res = await fetch(url)
  } catch (e) {
    throw new Error(`Cannot reach GitHub (are you offline?): ${message(e)}. Packs already in the project's cache still load; nothing was changed.`)
  }
  if (res.status === 404) throw new Error(`No release asset at ${url}. A pack release needs the asset pack.zip on the tag v<version>.`)
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}): ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

interface Fetched { bytes: Buffer; files: Map<string, Buffer>; manifest: PackManifest; nodes: number; changelog: string }

/** Unzips a downloaded asset and checks that it is a pack: `manifest.json` at the root (Spec schema) and node files that parse. */
function inspect(bytes: Buffer): Fetched {
  const files = readZip(bytes)
  const raw = files.get('manifest.json')
  if (!raw) throw new Error('The download is not a pack: pack.zip has no manifest.json at its root.')
  const manifest = PackManifest.parse(JSON.parse(raw.toString('utf8')))
  let nodes = 0
  for (const [name, data] of files) {
    if (!/^nodes\/[^/]+\.json$/.test(name)) continue
    const r = NodeDef.safeParse(JSON.parse(data.toString('utf8')))
    if (!r.success) throw new Error(`${name}: ${r.error.issues[0]?.message ?? 'invalid node definition'}`)
    nodes++
  }
  return { bytes, files, manifest, nodes, changelog: files.get('CHANGELOG.md')?.toString('utf8') ?? '' }
}

export interface PackManagerDeps {
  fetch: Fetch
  /** `INKWELL_PACKS_INDEX` overrides it. */
  indexUrl?: string
}

/** One per session. Candidates are downloads waiting for the user's yes; nothing touches the project before `install`. */
export function createPackManager(deps: PackManagerDeps) {
  const pending = new Map<string, { fetched: Fetched; entry: PackLockEntry }>()

  async function index(): Promise<PackResult<{ index: PackIndexEntry[] }>> {
    try {
      const bytes = await download(deps.fetch, deps.indexUrl ?? DEFAULT_INDEX_URL)
      return { ok: true, index: PackIndex.parse(JSON.parse(bytes.toString('utf8'))).packs }
    } catch (e) {
      return { ok: false, error: `Packs index: ${message(e)}` }
    }
  }

  /**
   * Downloads a pack for the install or update dialog. `version` absent = the latest release (GitHub's redirect); the pinned source of that
   * version must then exist too, so the lockfile resolves later. `expectSha` (a lockfile restore) refuses any other hash.
   */
  async function resolve(projectDir: string, ref: { repo: string; version?: string; expectSha?: string }, current?: PacksLock): Promise<PackResult<{ candidate: PackCandidate }>> {
    try {
      const bytes = await download(deps.fetch, packAssetUrl(ref.repo, ref.version))
      const hash = sha256(bytes)
      if (ref.expectSha && hash !== ref.expectSha) return { ok: false, error: `Hash mismatch for ${ref.repo} ${ref.version}: packs.lock says ${ref.expectSha}, the download is ${hash}. Refused; nothing was installed.` }
      const fetched = inspect(bytes)
      const { version } = fetched.manifest
      if (ref.version && ref.version !== version) return { ok: false, error: `The release v${ref.version} of ${ref.repo} contains version ${version} in its manifest. Refused.` }
      const source = packAssetUrl(ref.repo, version)
      if (!ref.version) {
        const head = await deps.fetch(source, { method: 'HEAD' }).catch(() => undefined)
        if (!head?.ok) return { ok: false, error: `The latest release of ${ref.repo} holds version ${version}, but ${source} does not exist: the release tag must be v${version}.` }
      }
      const lock = current ?? (await readLock(projectDir)).lock
      const old = lock.packs.find((p) => p.id === fetched.manifest.id)
      const token = randomUUID()
      pending.set(token, { fetched, entry: { id: fetched.manifest.id, version, source, sha256: hash } })
      return { ok: true, candidate: { token, id: fetched.manifest.id, version, repo: ref.repo, source, sha256: hash, changelog: fetched.changelog, nodes: fetched.nodes, ...(old ? { current: old.version } : {}) } }
    } catch (e) {
      return { ok: false, error: message(e) }
    }
  }

  /** Writes the candidate into the cache and packs.lock (one entry per id; an update replaces the old version's entry). */
  async function install(projectDir: string, token: string): Promise<PackResult> {
    const p = pending.get(token)
    if (!p) return { ok: false, error: 'This download is no longer pending; start again.' }
    const { lock, error } = await readLock(projectDir)
    if (error) return { ok: false, error }
    if (p.entry.id === 'core') return { ok: false, error: 'The core pack ships with the editor and cannot be installed from GitHub.' }
    try {
      await writeCache(projectDir, p.entry, p.fetched)
      const next: PacksLock = { ...lock, packs: [...lock.packs.filter((e) => e.id !== p.entry.id), p.entry] }
      await writeFile(join(projectDir, 'packs.lock'), writePacksLock(next))
      pending.delete(token)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: message(e) }
    }
  }

  /** Downloads every locked pack the cache lacks (or holds with another hash) from its pinned source; a different hash is refused. Never edits packs.lock. */
  async function restore(projectDir: string): Promise<PackResult<{ restored: string[]; errors: string[] }>> {
    const { lock, error } = await readLock(projectDir)
    if (error) return { ok: false, error }
    const { locked } = await lockedPacks(projectDir, lock)
    const restored: string[] = []
    const errors: string[] = []
    for (const e of locked.filter((l) => l.state !== 'ok')) {
      try {
        const bytes = await download(deps.fetch, e.source) // the lockfile's source, so a pack removed from the index still resolves
        const hash = sha256(bytes)
        if (hash !== e.sha256) throw new Error(`hash mismatch: packs.lock says ${e.sha256}, the download is ${hash}. Refused.`)
        const fetched = inspect(bytes)
        if (fetched.manifest.id !== e.id || fetched.manifest.version !== e.version) throw new Error(`the download is ${fetched.manifest.id}@${fetched.manifest.version}. Refused.`)
        await writeCache(projectDir, e, fetched)
        restored.push(`${e.id}@${e.version}`)
      } catch (x) {
        errors.push(`${e.id}@${e.version}: ${message(x)}`)
      }
    }
    return { ok: true, restored, errors }
  }

  /** Newer releases of the locked packs (only on request; nothing is written). Each candidate carries its changelog for the update dialog. */
  async function checkUpdates(projectDir: string): Promise<PackResult<{ updates: PackCandidate[]; errors: string[] }>> {
    const { lock, error } = await readLock(projectDir)
    if (error) return { ok: false, error }
    const idx = await index()
    const listed = new Map((idx.ok ? idx.index : []).map((e) => [e.id, e]))
    const updates: PackCandidate[] = []
    const errors: string[] = idx.ok ? [] : [idx.error]
    for (const e of lock.packs) {
      const repo = listed.get(e.id)?.repo ?? repoOf(e.source)
      if (!repo) { errors.push(`${e.id}: no GitHub repo in its source ${e.source}`); continue }
      const r = await resolve(projectDir, { repo }, lock)
      if (!r.ok) { errors.push(`${e.id}: ${r.error}`); continue }
      if (r.candidate.id !== e.id) { errors.push(`${e.id}: the latest release of ${repo} is the pack "${r.candidate.id}"`); pending.delete(r.candidate.token); continue }
      if (cmp(r.candidate.version, e.version) <= 0) { pending.delete(r.candidate.token); continue }
      const dep = listed.get(e.id)?.deprecated
      updates.push({ ...r.candidate, ...(dep ? { deprecated: dep } : {}) })
    }
    return { ok: true, updates, errors }
  }

  async function state(projectDir: string): Promise<PacksState> {
    const { lock, error } = await readLock(projectDir)
    return { locked: (await lockedPacks(projectDir, lock)).locked, ...(error ? { lockError: error } : {}) }
  }

  return { index, resolve, install, restore, checkUpdates, state, clear: (): void => pending.clear() }
}

/** `<cache>/<id>@<version>.zip` plus the extracted folder, written to a temp folder first so a failed write never leaves half a pack. */
async function writeCache(projectDir: string, e: { id: string; version: string }, f: Fetched): Promise<void> {
  const dir = entryDir(projectDir, e)
  const tmp = `${dir}.tmp-${process.pid}`
  await rm(tmp, { recursive: true, force: true })
  for (const [name, data] of f.files) {
    await mkdir(dirname(join(tmp, name)), { recursive: true })
    await writeFile(join(tmp, name), data)
  }
  await rm(dir, { recursive: true, force: true })
  await rename(tmp, dir)
  await writeFile(`${dir}.zip`, f.bytes)
}
