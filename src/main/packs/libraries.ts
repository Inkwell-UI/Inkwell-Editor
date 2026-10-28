import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { SPEC_VERSION, type Graph, type NodeDef } from '@inkwell-ui/spec'
import { isGraphId } from '../../shared/graphs'
import { validateGraph } from '../../shared/graphValidate'
import type { Fallible } from '../../shared/functions'
import { readZip, writeZip } from '../deploy/zip'
import { loadPack } from './index'

/**
 * Function libraries (docs/functions.md, Libraries). A library is a pack folder whose `functions/` holds function graphs: `manifest.json`, `functions/<id>.json`, `CHANGELOG.md`
 * (and, for a pack that also has nodes, `nodes/` and `templates/`). Export writes one from the project's functions; import copies a pack folder or zip into
 * `<project>/libraries/<packId>/`, which the editor loads like any other pack folder (no packs.lock entry: it is the project's own copy, kept in git with the project).
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

export interface ExportInput {
  /** Every function graph of the SWF (the selection is checked against them). */
  functions: readonly Graph[]
  /** Ids of the functions to export. */
  selected: readonly string[]
  pack: { id: string; version: string; description?: string; credits?: string; license?: string }
  defs: ReadonlyMap<string, NodeDef>
  /** Library functions already installed (a call to one becomes a dependency on its pack). */
  library?: ReadonlyMap<string, Graph>
  /** Versions of the loaded packs by id, for the `dependencies` ranges. */
  packVersions: ReadonlyMap<string, string>
  toolVersion: string
  /** Parent folder: the pack folder `<outDir>/<id>/` and `<outDir>/<id>-<version>.zip` are written there. */
  outDir: string
}

/**
 * Writes the selected functions as a pack folder and a zip of it. Refused (nothing written) when: the pack id or version is invalid, a selected function calls a project function that
 * is not selected (it names the missing one), or a selected function has graph errors. Calls between the exported functions become `<packId>/<id>`. The zip holds the pack at its root:
 * upload it as `pack.zip` on the GitHub release `v<version>` to publish (Inkwell-Core-Pack docs/packs.md, Release).
 */
export async function exportLibrary(i: ExportInput): Promise<Fallible<{ folder: string; zip: string; functions: string[]; dependencies: Record<string, string> }>> {
  const { id, version } = i.pack
  if (!PACK_ID.test(id) || id === 'core') return { ok: false, error: id === 'core' ? 'The id "core" belongs to the bundled core pack.' : 'The pack id may use lower-case letters, digits, ".", "_" and "-", and starts with a letter or digit.' }
  if (!SEMVER.test(version)) return { ok: false, error: 'The version must look like 1.0.0.' }
  if (i.selected.length === 0) return { ok: false, error: 'Tick the functions to export.' }
  const byId = new Map(i.functions.map((g) => [g.id, g]))
  const chosen: Graph[] = []
  for (const sel of i.selected) {
    const g = byId.get(sel)
    if (!g) return { ok: false, error: `There is no function "${sel}".` }
    if (!isGraphId(g.id)) return { ok: false, error: `The function id "${g.id}" cannot be a file name.` }
    chosen.push(g)
  }
  const picked = new Set(chosen.map((g) => g.id))
  for (const g of chosen)
    for (const c of callsOf(g))
      if (!c.includes('/') && !picked.has(c)) return { ok: false, error: `"${g.name}" calls "${byId.get(c)?.name ?? c}", which is not ticked. Tick it too: a library must contain every function it calls.` }
  for (const g of chosen) {
    const bad = validateGraph(g, { defs: i.defs, siblings: chosen, ...(i.library ? { library: i.library } : {}) }).filter((x) => x.level === 'error')
    if (bad.length) return { ok: false, error: `"${g.name}" has errors: ${bad.slice(0, 3).map((x) => x.message).join(' ')}` }
  }
  // the exported copies: calls between the chosen functions use the qualified id
  const copies = chosen.map((g) => ({ ...g, specVersion: SPEC_VERSION, nodes: g.nodes.map((n) => (n.kind.split('/')[1]?.startsWith('CallFunction@') && picked.has(String(n.fields['function'])) ? { ...n, fields: { ...n.fields, function: `${id}/${n.fields['function']}` } } : n)) }) as Graph)
  const used = new Set<string>()
  for (const g of copies) {
    for (const n of g.nodes) used.add(n.kind.split('/')[0]!)
    for (const c of callsOf(g)) if (c.includes('/')) used.add(c.split('/')[0]!)
  }
  used.delete(id)
  const dependencies = Object.fromEntries([...used].sort().map((p) => [p, `^${i.packVersions.get(p) ?? '0.0.0'}`]))
  const tool = /^(\d+)\.(\d+)/.exec(i.toolVersion)
  const manifest = {
    id, version,
    compatible: { tool: `^${tool?.[1] ?? 0}.${tool?.[2] ?? 0}.0` },
    dependencies,
    ...(i.pack.description || i.pack.credits || i.pack.license ? { extra: { ...(i.pack.description ? { description: i.pack.description } : {}), ...(i.pack.credits ? { credits: i.pack.credits } : {}), ...(i.pack.license ? { license: i.pack.license } : {}) } } : {})
  }
  const files: { name: string; data: Uint8Array }[] = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') },
    { name: 'CHANGELOG.md', data: Buffer.from(`# Changelog\n\n## ${version}\n\nFunctions: ${chosen.map((g) => g.name).join(', ')}.\n`) },
    ...copies.map((g) => ({ name: `functions/${g.id}.json`, data: Buffer.from(JSON.stringify(g, null, 2) + '\n') }))
  ]
  const folder = join(i.outDir, id)
  const zip = join(i.outDir, `${id}-${version}.zip`)
  try {
    await rm(folder, { recursive: true, force: true })
    for (const f of files) {
      await mkdir(dirname(join(folder, f.name)), { recursive: true })
      await writeFile(join(folder, f.name), f.data)
    }
    await writeFile(zip, writeZip(files))
  } catch (e) {
    return { ok: false, error: `Could not write the files: ${e instanceof Error ? e.message : String(e)}` }
  }
  return { ok: true, folder, zip, functions: chosen.map((g) => g.id), dependencies }
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

/** Removes a library from the project. Calls to its functions then show the lint error "not installed". */
export async function removeLibrary(projectDir: string, id: string): Promise<Fallible<Record<never, never>>> {
  if (!PACK_ID.test(id)) return { ok: false, error: 'Not a library id.' }
  await rm(join(projectDir, LIBRARIES_DIR, id), { recursive: true, force: true })
  return { ok: true }
}
