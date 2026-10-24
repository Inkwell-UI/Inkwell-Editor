import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { installedFileName, registryName, type FontToolStatus } from '../../shared/fonts'
import { parseRegValue } from '../doctor/skyrim'
import type { ConvertedFont } from './convert'

/** Where fonts go and how the registry is reached. The real one is per user (HKCU + %LOCALAPPDATA%); tests and the sandbox inject their own. */
export interface FontSystem {
  fontsDir: string
  manifestPath: string
  regGet(name: string): Promise<string | undefined>
  regSet(name: string, value: string): Promise<void>
  regDelete(name: string): Promise<void>
}

export const FONTS_KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'

/** The real per-user font system: %LOCALAPPDATA%\Microsoft\Windows\Fonts and HKCU\...\Fonts through reg.exe (never HKLM, never C:\Windows\Fonts). */
export function windowsFontSystem(localAppData: string): FontSystem {
  const reg = (args: string[]): Promise<string> =>
    new Promise((res, rej) => execFile('reg', args, { timeout: 15000, windowsHide: true }, (e, out, err) => (e ? rej(new Error(`reg ${args[0]} failed: ${err || e.message}`)) : res(out))))
  return {
    fontsDir: join(localAppData, 'Microsoft', 'Windows', 'Fonts'),
    manifestPath: join(localAppData, 'Inkwell', 'skyrim-fonts-manifest.json'),
    // reg query exits 1 for a missing value: that is "absent", not an error
    regGet: (name) => reg(['query', FONTS_KEY, '/v', name]).then((out) => parseRegValue(out, name), () => undefined),
    regSet: (name, value) => reg(['add', FONTS_KEY, '/v', name, '/t', 'REG_SZ', '/d', value, '/f']).then(() => undefined),
    regDelete: (name) => reg(['delete', FONTS_KEY, '/v', name, '/f']).then(() => undefined)
  }
}

/** Debug sandbox (INKWELL_FONTS_SANDBOX): fonts in `<dir>/Fonts`, the "registry" in `<dir>/registry.json`. Nothing reaches Windows. */
export function sandboxFontSystem(dir: string): FontSystem {
  const file = join(dir, 'registry.json')
  const load = (): Promise<Record<string, string>> => readFile(file, 'utf8').then((t) => JSON.parse(t) as Record<string, string>, () => ({}))
  const save = async (r: Record<string, string>): Promise<void> => {
    await mkdir(dir, { recursive: true })
    await writeFile(file, JSON.stringify(r, null, 2))
  }
  return {
    fontsDir: join(dir, 'Fonts'),
    manifestPath: join(dir, 'manifest.json'),
    regGet: async (n) => (await load())[n],
    regSet: async (n, v) => save({ ...(await load()), [n]: v }),
    regDelete: async (n) => {
      const r = await load()
      delete r[n]
      await save(r)
    }
  }
}

export interface ManifestEntry {
  family: string
  style: string
  file: string
  regName: string
  sha256: string
}
export interface Manifest {
  version: 1
  installedAt: string
  fonts: ManifestEntry[]
}

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

export async function readManifest(path: string): Promise<Manifest | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined)
  if (text === undefined) return undefined
  const m = JSON.parse(text) as Manifest // a damaged manifest throws: never guess what to delete
  if (m.version !== 1 || !Array.isArray(m.fonts)) throw new Error(`Unrecognised font manifest ${path}`)
  return m
}

async function writeManifest(path: string, m: Manifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path + '.tmp', JSON.stringify(m, null, 2) + '\n')
  await rename(path + '.tmp', path)
}

export async function fontStatus(sys: FontSystem, platformOk = true): Promise<FontToolStatus> {
  const m = await readManifest(sys.manifestPath)
  return {
    platformOk,
    installed: !!m?.fonts.length,
    faces: (m?.fonts ?? []).map((f) => ({ family: f.family, style: f.style, file: f.file, present: existsSync(f.file) })),
    fontsDir: sys.fontsDir,
    manifestPath: sys.manifestPath
  }
}

export class FontToolError extends Error {
  constructor(readonly code: 'already-installed' | 'foreign' | 'failed', message: string) {
    super(message)
  }
}

/**
 * Copies each font to the per-user fonts folder and registers it, recording every step in the manifest as it happens.
 * Refuses up front when a target file or registry value already exists (fonts the tool did not install are never overwritten).
 * On a failure midway it reverses what it did, so nothing half-installed is left behind.
 */
export async function installFonts(fonts: ConvertedFont[], sys: FontSystem, onStep?: (done: number, total: number) => void): Promise<void> {
  if ((await readManifest(sys.manifestPath))?.fonts.length) throw new FontToolError('already-installed', `The fonts are already installed (manifest ${sys.manifestPath}). Remove them first.`)
  const plan = fonts.map((f) => ({ f, file: join(sys.fontsDir, installedFileName(f.face)), regName: registryName(f.face) }))
  const clashes: string[] = []
  for (const p of plan) {
    if (existsSync(p.file)) clashes.push(p.file)
    const v = await sys.regGet(p.regName)
    if (v !== undefined) clashes.push(`registry value "${p.regName}" (${v})`)
  }
  if (clashes.length) throw new FontToolError('foreign', `Refusing to overwrite fonts Inkwell did not install: ${clashes.join('; ')}.`)
  const m: Manifest = { version: 1, installedAt: new Date().toISOString(), fonts: [] }
  await mkdir(sys.fontsDir, { recursive: true })
  try {
    for (const [i, p] of plan.entries()) {
      // wx: never replace a file that appeared since the check
      await writeFile(p.file, p.f.bytes, { flag: 'wx' })
      m.fonts.push({ family: p.f.face.family, style: p.f.face.style, file: p.file, regName: p.regName, sha256: sha(p.f.bytes) })
      await writeManifest(sys.manifestPath, m)
      await sys.regSet(p.regName, p.file)
      onStep?.(i + 1, plan.length)
    }
  } catch (e) {
    const left = await uninstallFonts(sys).catch((u: unknown) => [`rollback failed: ${u instanceof Error ? u.message : String(u)}`])
    throw new FontToolError('failed', `Install failed: ${e instanceof Error ? e.message : String(e)}${left.length ? `. ${left.join(' ')}` : '. Everything it had done was reversed.'}`)
  }
}

/**
 * Reverses exactly what the manifest lists: a registry value only while it still points at the file Inkwell wrote, a file only while it still has
 * the bytes Inkwell wrote. Entries that could not be removed (a locked file) stay in the manifest for the next try. Returns warnings.
 */
export async function uninstallFonts(sys: FontSystem, onStep?: (done: number, total: number) => void): Promise<string[]> {
  const m = await readManifest(sys.manifestPath)
  if (!m) return []
  const warnings: string[] = []
  const keep: ManifestEntry[] = []
  for (const [i, f] of m.fonts.entries()) {
    const cur = await sys.regGet(f.regName)
    if (cur !== undefined && cur.toLowerCase() === f.file.toLowerCase()) await sys.regDelete(f.regName)
    else if (cur !== undefined) warnings.push(`Registry value "${f.regName}" now points to ${cur}; left alone.`)
    const bytes = await readFile(f.file).catch(() => undefined)
    if (bytes && sha(bytes) !== f.sha256) warnings.push(`${f.file} was changed since Inkwell installed it; left alone.`)
    else if (bytes) {
      try {
        await unlink(f.file)
      } catch (e) {
        warnings.push(`${f.file} could not be deleted (${(e as NodeJS.ErrnoException).code ?? 'error'}; in use by Figma?). Close Figma and press Remove again.`)
        keep.push(f)
      }
    }
    onStep?.(i + 1, m.fonts.length)
  }
  if (keep.length) await writeManifest(sys.manifestPath, { ...m, fonts: keep })
  else await rm(sys.manifestPath, { force: true })
  return warnings
}
