import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { Graph, NodeDef } from '@inkwell-ui/spec'
import { validateGraph } from '../../shared/graphValidate'
import type { Fallible } from '../../shared/functions'
import { readZip, writeZip } from '../deploy/zip'
import { loadPack } from './index'

/**
 * Packs of the project (docs/functions.md, Libraries). A pack is a folder: `manifest.json`, optional `nodes/` (pure nodes), optional `functions/<id>.json` (function graphs, called as
 * `<packId>/<id>`), `CHANGELOG.md`. The project's own packs live in `<project>/libraries/<packId>/`, which the editor loads like any other pack folder (no packs.lock entry: it is the
 * project's own copy, kept in git with the project). Create makes an empty one, the editor moves functions into it, export writes the folder and a zip, import copies one in.
 */
export const LIBRARIES_DIR = 'libraries'
const PACK_ID = /^[a-z0-9][a-z0-9._-]*$/
const SEMVER = /^\d+\.\d+\.\d+$/

/** The pack folders under `<project>/libraries/` (a folder needs a manifest.json). */
export async function localLibraryDirs(projectDir: string): Promise<string[]> {
  const root = join(projectDir, LIBRARIES_DIR)
  const out: string[] = []
  for (const d of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const dir = join(root, d.name)
    if (d.isDirectory() && (await stat(join(dir, 'manifest.json')).catch(() => undefined))) out.push(dir)
  }
  return out.sort()
}

const callsOf = (g: Graph): string[] =>
  g.nodes.flatMap((n) => (n.kind.split('/')[1]?.startsWith('CallFunction@') && typeof n.fields['function'] === 'string' ? [n.fields['function'] as string] : []))

const badId = (id: string): string | undefined =>
  id === 'core' ? 'The id "core" belongs to the bundled core pack.' : PACK_ID.test(id) ? undefined : 'The pack id may use lower-case letters, digits, ".", "_" and "-", and starts with a letter or digit.'
const toolRange = (toolVersion: string): string => {
  const t = /^(\d+)\.(\d+)/.exec(toolVersion)
  return `^${t?.[1] ?? 0}.${t?.[2] ?? 0}.0`
}
const extraOf = (p: { description?: string | undefined; credits?: string | undefined; license?: string | undefined }) =>
  p.description || p.credits || p.license ? { extra: { ...(p.description ? { description: p.description } : {}), ...(p.credits ? { credits: p.credits } : {}), ...(p.license ? { license: p.license } : {}) } } : {}

/** A new, empty pack `<project>/libraries/<id>/` (manifest, `functions/`, changelog). Refused when the id is invalid, `core`, or already there. */
export async function createLibrary(projectDir: string, p: { id: string; version: string; description?: string; credits?: string }, toolVersion: string): Promise<Fallible<{ id: string }>> {
  const bad = badId(p.id)
  if (bad) return { ok: false, error: bad }
  if (!SEMVER.test(p.version)) return { ok: false, error: 'The version must look like 1.0.0.' }
  const dir = join(projectDir, LIBRARIES_DIR, p.id)
  if (await stat(dir).catch(() => undefined)) return { ok: false, error: `The pack "${p.id}" is already in this project.` }
  try {
    await mkdir(join(dir, 'functions'), { recursive: true })
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ id: p.id, version: p.version, compatible: { tool: toolRange(toolVersion) }, dependencies: {}, ...extraOf(p) }, null, 2) + '\n')
    await writeFile(join(dir, 'CHANGELOG.md'), `# Changelog\n\n## ${p.version}\n\nFirst version.\n`)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true, id: p.id }
}

/** Moves a function graph (already saved in the renderer's terms: its calls are checked here) into the pack: refuses a function that calls one of the SWF's own functions (a pack cannot see them) or an id the pack has. */
export async function addFunctionToLibrary(projectDir: string, packId: string, fn: Graph): Promise<Fallible<{ id: string }>> {
  if (!PACK_ID.test(packId)) return { ok: false, error: 'Not a pack id.' }
  const own = callsOf(fn).find((c) => !c.includes('/'))
  if (own) return { ok: false, error: `"${fn.name}" calls the project function "${own}". Move that one into a pack first: a pack cannot call functions of the project.` }
  const file = join(projectDir, LIBRARIES_DIR, packId, 'functions', `${fn.id}.json`)
  if (await stat(file).catch(() => undefined)) return { ok: false, error: `The pack "${packId}" already has a function "${fn.id}".` }
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(fn, null, 2) + '\n')
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true, id: fn.id }
}

export interface ExportInput {
  projectDir: string
  packId: string
  /** New version for the pack (written back into the project's manifest); the manifest's own when absent. */
  version?: string
  defs: ReadonlyMap<string, NodeDef>
  /** Every library function by `<packId>/<functionId>` (a call to another pack's function becomes a dependency). */
  library: ReadonlyMap<string, Graph>
  /** Versions of the loaded packs by id, for the `dependencies` ranges. */
  packVersions: ReadonlyMap<string, string>
  toolVersion: string
  /** Parent folder: the pack folder `<outDir>/<id>/` and `<outDir>/<id>-<version>.zip` are written there. */
  outDir: string
}

/**
 * Writes one of the project's packs as a folder and a zip of it. Refused (nothing written) when the pack does not load, is empty, the version is invalid, or one of its functions has graph
 * errors. `dependencies` is recomputed from the nodes and calls the pack uses. The zip holds the pack at its root: upload it as `pack.zip` on the GitHub release `v<version>` to publish
 * (Inkwell-Core-Pack docs/packs.md, Release).
 */
export async function exportPack(i: ExportInput): Promise<Fallible<{ folder: string; zip: string; version: string; functions: string[]; dependencies: Record<string, string> }>> {
  const src = join(i.projectDir, LIBRARIES_DIR, i.packId)
  const r = await loadPack(src)
  if (!r.pack) return { ok: false, error: r.problems[0] ?? `There is no pack "${i.packId}" in this project.` }
  if (r.problems.length) return { ok: false, error: r.problems[0]! }
  const { manifest } = r.pack
  const fns = r.pack.functions ?? []
  if (fns.length + r.pack.nodes.length === 0) return { ok: false, error: `The pack "${i.packId}" is empty: drag a function onto it first.` }
  const version = i.version ?? manifest.version
  if (!SEMVER.test(version)) return { ok: false, error: 'The version must look like 1.0.0.' }
  for (const g of fns) {
    const bad = validateGraph({ ...g, id: `${i.packId}/${g.id}` }, { defs: i.defs, library: i.library }).filter((x) => x.level === 'error')
    if (bad.length) return { ok: false, error: `"${g.name}" has errors: ${bad.slice(0, 3).map((x) => x.message).join(' ')}` }
  }
  const used = new Set<string>()
  for (const g of fns) {
    for (const n of g.nodes) used.add(n.kind.split('/')[0]!)
    for (const c of callsOf(g)) if (c.includes('/')) used.add(c.split('/')[0]!)
  }
  used.delete(i.packId)
  const dependencies = Object.fromEntries([...used].sort().map((p) => [p, `^${i.packVersions.get(p) ?? '0.0.0'}`]))
  const next = { ...manifest, version, compatible: { tool: toolRange(i.toolVersion) }, dependencies }
  const folder = join(i.outDir, i.packId)
  const zip = join(i.outDir, `${i.packId}-${version}.zip`)
  try {
    // the project's copy gets the new version and dependencies too, so the next export starts from them
    await writeFile(join(src, 'manifest.json'), JSON.stringify(next, null, 2) + '\n')
    if (version !== manifest.version) await writeFile(join(src, 'CHANGELOG.md'), `${await readFile(join(src, 'CHANGELOG.md'), 'utf8').catch(() => '# Changelog\n')}`.replace(/(# Changelog\r?\n)/, `$1\n## ${version}\n\nFunctions: ${fns.map((g) => g.name).join(', ')}.\n`))
    await rm(folder, { recursive: true, force: true })
    await cp(src, folder, { recursive: true, filter: (s) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(s) })
    const files: { name: string; data: Uint8Array }[] = []
    for (const rel of (await readdir(folder, { recursive: true })).map((x) => x.replace(/\\/g, '/')).sort())
      if ((await stat(join(folder, rel))).isFile()) files.push({ name: rel, data: await readFile(join(folder, rel)) })
    await writeFile(zip, writeZip(files))
  } catch (e) {
    return { ok: false, error: `Could not write the files: ${e instanceof Error ? e.message : String(e)}` }
  }
  return { ok: true, folder, zip, version, functions: fns.map((g) => g.id), dependencies }
}

export interface ImportResult {
  id: string
  version: string
  functions: string[]
  nodes: number
}

/**
 * Copies a pack folder or a pack zip into `<project>/libraries/<id>/`. The pack is read with the normal loader first, so a broken one is refused with its problems. An id that is
 * already there is replaced only with `replace` (the answer `exists: true` lets the caller ask). `core` is refused: the bundled pack always wins that id.
 */
export async function importLibrary(projectDir: string, src: string, opts: { replace?: boolean } = {}): Promise<Fallible<ImportResult> | { ok: false; error: string; exists: true }> {
  let dir = src
  let temp: string | undefined
  try {
    const st = await stat(src).catch(() => undefined)
    if (!st) return { ok: false, error: `${src} does not exist.` }
    if (st.isFile()) {
      let entries: Map<string, Buffer>
      try {
        entries = readZip(await readFile(src))
      } catch (e) {
        return { ok: false, error: `Not a readable zip: ${e instanceof Error ? e.message : String(e)}` }
      }
      temp = await mkdtemp(join(tmpdir(), 'inkwell-lib-'))
      for (const [name, data] of entries) {
        const dest = resolve(temp, name)
        if (!dest.startsWith(resolve(temp) + sep)) return { ok: false, error: `The zip holds a path that leaves the pack folder: ${name}` }
        if (name.endsWith('/')) continue
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, data)
      }
      dir = temp
    }
    const r = await loadPack(dir)
    const hasContent = (r.pack?.functions?.length ?? 0) + (r.pack?.nodes.length ?? 0) > 0
    if (!r.pack || !hasContent) return { ok: false, error: r.problems[0] ?? `${basename(src)} holds no functions or nodes (it needs manifest.json and a functions/ folder).` }
    const id = r.pack.manifest.id
    if (id === 'core') return { ok: false, error: 'The id "core" belongs to the bundled core pack; a library cannot use it.' }
    const target = join(projectDir, LIBRARIES_DIR, id)
    if (!opts.replace && (await stat(target).catch(() => undefined))) return { ok: false, error: `The library "${id}" is already in this project.`, exists: true }
    await rm(target, { recursive: true, force: true })
    await mkdir(dirname(target), { recursive: true })
    await cp(dir, target, { recursive: true, filter: (s) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(s) })
    return { ok: true, id, version: r.pack.manifest.version, functions: (r.pack.functions ?? []).map((g) => g.id), nodes: r.pack.nodes.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Deletes one function of a project pack. Calls to it then show the lint error "not installed". */
export async function removeLibraryFunction(projectDir: string, packId: string, fnId: string): Promise<Fallible<Record<never, never>>> {
  if (!PACK_ID.test(packId) || !/^[a-z0-9][a-z0-9._-]*$/.test(fnId)) return { ok: false, error: 'Not a function of a project pack.' }
  const file = join(projectDir, LIBRARIES_DIR, packId, 'functions', `${fnId}.json`)
  if (!(await stat(file).catch(() => undefined))) return { ok: false, error: `"${packId}" is not a project pack with a function "${fnId}".` }
  await rm(file)
  return { ok: true }
}

/** Removes a library from the project. Calls to its functions then show the lint error "not installed". */
export async function removeLibrary(projectDir: string, id: string): Promise<Fallible<Record<never, never>>> {
  if (!PACK_ID.test(id)) return { ok: false, error: 'Not a library id.' }
  await rm(join(projectDir, LIBRARIES_DIR, id), { recursive: true, force: true })
  return { ok: true }
}
