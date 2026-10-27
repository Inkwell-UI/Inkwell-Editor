import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packAssetUrl, parsePacksLock, SPEC_VERSION, writePacksLock } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { defIndex, emptyGraph } from '../../shared/graphs'
import { validateGraph } from '../../shared/graphValidate'
import { writeZip } from '../deploy/zip'
import { loadPacks } from './index'
import { createPackManager, DEFAULT_INDEX_URL, lockedPacks, packCacheDir, parseGitHubRef, readLock, type Fetch } from './manager'

const node = { kind: 'Hello', major: 1, title: 'Hello', category: 'Text', pure: true, inputs: [{ name: 'name', type: 'String', default: 'World' }], outputs: [{ name: 'text', type: 'String' }], fields: {}, as2Template: 'templates/Hello.as2' }
const pack = (version: string, changelog = `## ${version}\n- Hello node`): Buffer =>
  writeZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ id: 'hello', version, compatible: { tool: '^0.5.0' } })) },
    { name: 'nodes/Hello.json', data: Buffer.from(JSON.stringify(node)) },
    { name: 'templates/Hello.as2', data: Buffer.from('// [{{node.id}}] hello/Hello@1\n"Hello, " + String({{in.name}})\n') },
    { name: 'CHANGELOG.md', data: Buffer.from(changelog) }
  ])
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const REPO = 'me/inkwell-hello'

/** A fake GitHub: url -> bytes; `latest` is what releases/latest/download serves; `offline` makes every request throw like fetch does. */
function github(releases: Record<string, Buffer>, opts: { latest?: string; index?: object; offline?: boolean } = {}) {
  const urls = new Map<string, Buffer>(Object.entries(releases).map(([v, b]) => [packAssetUrl(REPO, v), b]))
  if (opts.latest) urls.set(packAssetUrl(REPO), releases[opts.latest]!)
  urls.set(DEFAULT_INDEX_URL, Buffer.from(JSON.stringify(opts.index ?? { packs: [{ id: 'hello', repo: REPO, latest: opts.latest ?? '1.0.0' }] })))
  const calls: string[] = []
  const fetch: Fetch = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (opts.offline) throw new TypeError('fetch failed')
    const b = urls.get(url)
    return { ok: !!b, status: b ? 200 : 404, arrayBuffer: async () => new Uint8Array(b ?? []).buffer }
  }
  return { fetch, urls, calls }
}
const project = () => mkdtemp(join(tmpdir(), 'inkwell-packs-'))

describe('pack manager', () => {
  it('adds a pack by GitHub URL: shows repo, version, hash and changelog first, writes nothing until install, then loads through the pack loader', async () => {
    const dir = await project()
    const v1 = pack('1.0.0')
    const m = createPackManager(github({ '1.0.0': v1 }, { latest: '1.0.0' }))
    const r = await m.resolve(dir, parseGitHubRef('https://github.com/me/inkwell-hello')!)
    if (!r.ok) throw new Error(r.error)
    expect(r.candidate).toMatchObject({ id: 'hello', version: '1.0.0', repo: REPO, source: packAssetUrl(REPO, '1.0.0'), sha256: sha(v1), nodes: 1, changelog: '## 1.0.0\n- Hello node' })
    await expect(readFile(join(dir, 'packs.lock'))).rejects.toThrow() // nothing written yet
    expect(await m.install(dir, r.candidate.token)).toEqual({ ok: true })
    const lock = parsePacksLock(await readFile(join(dir, 'packs.lock'), 'utf8'))
    expect(lock.packs).toEqual([{ id: 'hello', version: '1.0.0', source: packAssetUrl(REPO, '1.0.0'), sha256: sha(v1) }])
    const { locked, dirs } = await lockedPacks(dir, lock)
    expect(locked[0]!.state).toBe('ok')
    expect([...defIndex(await loadPacks(dirs)).keys()]).toEqual(['hello/Hello@1'])
    expect(await m.install(dir, r.candidate.token)).toMatchObject({ ok: false }) // a token is used once
  })

  it('refuses a hash mismatch: a restored download must equal packs.lock, and a changed cache file is not loaded', async () => {
    const dir = await project()
    const v1 = pack('1.0.0')
    const entry = { id: 'hello', version: '1.0.0', source: packAssetUrl(REPO, '1.0.0'), sha256: sha(v1) }
    await writeFile(join(dir, 'packs.lock'), writePacksLock({ specVersion: SPEC_VERSION, packs: [entry] }))
    const tampered = github({ '1.0.0': pack('1.0.0', 'evil') })
    const r = await createPackManager(tampered).restore(dir)
    expect(r.ok && r.errors[0]).toMatch(/hello@1\.0\.0: hash mismatch: packs\.lock says [0-9a-f]{64}, the download is [0-9a-f]{64}\. Refused\./)
    expect((await lockedPacks(dir, (await readLock(dir)).lock)).locked[0]!.state).toBe('missing')
    // a good restore, then the cached zip changes on disk
    expect(await createPackManager(github({ '1.0.0': v1 })).restore(dir)).toEqual({ ok: true, restored: ['hello@1.0.0'], errors: [] })
    await writeFile(join(packCacheDir(dir), 'hello@1.0.0.zip'), pack('1.0.0', 'changed'))
    const after = await lockedPacks(dir, (await readLock(dir)).lock)
    expect(after.locked[0]!.state).toBe('mismatch')
    expect(after.dirs).toEqual([])
    // resolve with an expected hash refuses too
    const x = await createPackManager(tampered).resolve(dir, { repo: REPO, version: '1.0.0', expectSha: sha(v1) })
    expect(x).toMatchObject({ ok: false, error: expect.stringContaining('Hash mismatch') })
  })

  it('a pack removed from the index (or deprecated) still resolves from the lockfile', async () => {
    const dir = await project()
    const v1 = pack('1.0.0')
    await writeFile(join(dir, 'packs.lock'), writePacksLock({ specVersion: SPEC_VERSION, packs: [{ id: 'hello', version: '1.0.0', source: packAssetUrl(REPO, '1.0.0'), sha256: sha(v1) }] }))
    const gh = github({ '1.0.0': v1 }, { index: { packs: [] } })
    const r = await createPackManager(gh).restore(dir)
    expect(r).toEqual({ ok: true, restored: ['hello@1.0.0'], errors: [] })
    expect(gh.calls).toEqual([`GET ${packAssetUrl(REPO, '1.0.0')}`]) // the index is never asked
    expect((await lockedPacks(dir, (await readLock(dir)).lock)).locked[0]!.state).toBe('ok')
  })

  it('offline: clear errors, nothing changes, cached packs keep loading', async () => {
    const dir = await project()
    const v1 = pack('1.0.0')
    const m = createPackManager(github({ '1.0.0': v1 }, { latest: '1.0.0' }))
    const r = await m.resolve(dir, { repo: REPO })
    if (!r.ok) throw new Error(r.error)
    await m.install(dir, r.candidate.token)
    const lockText = await readFile(join(dir, 'packs.lock'), 'utf8')
    const off = createPackManager(github({}, { offline: true }))
    expect(await off.index()).toMatchObject({ ok: false, error: expect.stringContaining('Cannot reach GitHub (are you offline?)') })
    expect(await off.resolve(dir, { repo: REPO })).toMatchObject({ ok: false, error: expect.stringContaining('nothing was changed') })
    const u = await off.checkUpdates(dir)
    expect(u.ok && u.updates).toEqual([])
    expect(u.ok && u.errors.join('\n')).toContain('offline')
    expect(await readFile(join(dir, 'packs.lock'), 'utf8')).toBe(lockText)
    expect((await lockedPacks(dir, (await readLock(dir)).lock)).dirs).toHaveLength(1)
  })

  it('updates only on request, with the changelog first; install replaces the entry (one per pack)', async () => {
    const dir = await project()
    const [v1, v2] = [pack('1.0.0'), pack('1.1.0', '## 1.1.0\n- Louder hello')]
    let m = createPackManager(github({ '1.0.0': v1 }, { latest: '1.0.0' }))
    const r = await m.resolve(dir, { repo: REPO })
    if (!r.ok) throw new Error(r.error)
    await m.install(dir, r.candidate.token)
    expect(await m.checkUpdates(dir)).toEqual({ ok: true, updates: [], errors: [] })
    m = createPackManager(github({ '1.0.0': v1, '1.1.0': v2 }, { latest: '1.1.0', index: { packs: [{ id: 'hello', repo: REPO, latest: '1.1.0', deprecated: 'Use hello2' }] } }))
    const u = await m.checkUpdates(dir)
    if (!u.ok) throw new Error(u.error)
    expect(u.updates).toEqual([expect.objectContaining({ id: 'hello', current: '1.0.0', version: '1.1.0', changelog: '## 1.1.0\n- Louder hello', sha256: sha(v2), deprecated: 'Use hello2' })])
    expect(parsePacksLock(await readFile(join(dir, 'packs.lock'), 'utf8')).packs[0]!.version).toBe('1.0.0') // not until install
    await m.install(dir, u.updates[0]!.token)
    const lock = parsePacksLock(await readFile(join(dir, 'packs.lock'), 'utf8'))
    expect(lock.packs).toEqual([{ id: 'hello', version: '1.1.0', source: packAssetUrl(REPO, '1.1.0'), sha256: sha(v2) }])
  })

  it('refuses a latest release whose tag is not v<version>, a release whose manifest has another version, a non-pack and the core id', async () => {
    const dir = await project()
    const gh = github({ '1.0.0': pack('1.0.0') }, { latest: '1.0.0' })
    gh.urls.delete(packAssetUrl(REPO, '1.0.0'))
    expect(await createPackManager(gh).resolve(dir, { repo: REPO })).toMatchObject({ ok: false, error: expect.stringContaining('the release tag must be v1.0.0') })
    expect(await createPackManager(github({ '2.0.0': pack('1.0.0') })).resolve(dir, { repo: REPO, version: '2.0.0' })).toMatchObject({ ok: false, error: expect.stringContaining('contains version 1.0.0') })
    expect(await createPackManager(github({ '1.0.0': writeZip([{ name: 'x.txt', data: Buffer.from('x') }]) })).resolve(dir, { repo: REPO, version: '1.0.0' })).toMatchObject({ ok: false, error: expect.stringContaining('no manifest.json') })
    expect(await createPackManager(github({})).resolve(dir, { repo: REPO, version: '9.9.9' })).toMatchObject({ ok: false, error: expect.stringContaining('No release asset') })
    const core = writeZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ id: 'core', version: '1.0.0', compatible: { tool: '*' } })) }])
    const m = createPackManager(github({ '1.0.0': core }))
    const r = await m.resolve(dir, { repo: REPO, version: '1.0.0' })
    expect(r.ok && (await m.install(dir, r.candidate.token))).toMatchObject({ ok: false, error: expect.stringContaining('core pack ships with the editor') })
  })

  it('an unreadable packs.lock is reported and never overwritten; the pre-0.5 placeholder reads as empty', async () => {
    const dir = await project()
    await writeFile(join(dir, 'packs.lock'), '{ broken')
    const m = createPackManager(github({ '1.0.0': pack('1.0.0') }))
    const r = await m.resolve(dir, { repo: REPO, version: '1.0.0' })
    expect(r.ok && (await m.install(dir, r.candidate.token))).toMatchObject({ ok: false, error: expect.stringContaining('will not overwrite') })
    expect(await readFile(join(dir, 'packs.lock'), 'utf8')).toBe('{ broken')
    expect((await m.state(dir)).lockError).toContain('packs.lock cannot be read')
    await writeFile(join(dir, 'packs.lock'), 'packs: []\n')
    expect(await readLock(dir)).toEqual({ lock: { specVersion: SPEC_VERSION, packs: [] } })
    await rm(join(dir, 'packs.lock'))
    expect(await m.state(dir)).toEqual({ locked: [] })
  })

  it('a node of a locked pack the cache lacks is kept and flagged; once restored it validates', async () => {
    const dir = await project()
    const v1 = pack('1.0.0')
    await writeFile(join(dir, 'packs.lock'), writePacksLock({ specVersion: SPEC_VERSION, packs: [{ id: 'hello', version: '1.0.0', source: packAssetUrl(REPO, '1.0.0'), sha256: sha(v1) }] }))
    const g = { ...emptyGraph('g', 'G', 'menu'), nodes: [{ id: 'h', kind: 'hello/Hello@1', fields: { future: 1 }, pos: { x: 0, y: 0 } }] }
    const issues = async () => validateGraph(g, { defs: defIndex(await loadPacks((await lockedPacks(dir, (await readLock(dir)).lock)).dirs)) }).map((i) => i.code)
    expect(await issues()).toEqual(['graph-unknown-node'])
    await createPackManager(github({ '1.0.0': v1 })).restore(dir)
    expect(await issues()).toEqual([])
  })

  it('parses what users paste', () => {
    expect(parseGitHubRef('me/inkwell-hello')).toEqual({ repo: REPO })
    expect(parseGitHubRef('https://github.com/me/inkwell-hello.git')).toEqual({ repo: REPO })
    expect(parseGitHubRef('https://github.com/me/inkwell-hello/')).toEqual({ repo: REPO })
    expect(parseGitHubRef('https://github.com/me/inkwell-hello/releases/tag/v1.2.3')).toEqual({ repo: REPO, version: '1.2.3' })
    expect(parseGitHubRef(packAssetUrl(REPO, '1.2.3'))).toEqual({ repo: REPO, version: '1.2.3' })
    expect(parseGitHubRef('https://github.com/me/inkwell-hello/tree/main')).toEqual({ repo: REPO })
    expect(parseGitHubRef('https://evil.example/me/x')).toBeUndefined()
    expect(parseGitHubRef('not a repo')).toBeUndefined()
  })
})
