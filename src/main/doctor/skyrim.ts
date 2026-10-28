import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Runs a command and resolves with its stdout; rejects on failure. Injected in tests. */
export type Run = (cmd: string, args: string[]) => Promise<string>
export const run: Run = (cmd, args) =>
  new Promise((res, rej) => execFile(cmd, args, { timeout: 15000, windowsHide: true, maxBuffer: 8 << 20 }, (err, out, errOut) => (err ? rej(err) : res(`${out}\n${errOut}`))))

const STEAM_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam'
const GOG_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games'
export const SKYRIM_FOLDER = 'Skyrim Special Edition'

/** `reg query` output -> value of one REG_SZ value (`InstallPath    REG_SZ    C:\...`). */
export function parseRegValue(out: string, name: string): string | undefined {
  const m = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, 'im').exec(out)
  return m?.[1]
}

/** Library folders of `steamapps/libraryfolders.vdf` (`"path"  "D:\\\\SteamLibrary"`), unescaped; the Steam folder itself is always first. */
export function parseLibraryFolders(vdf: string, steamPath: string): string[] {
  const out = [steamPath]
  for (const m of vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
    const p = m[1]!.replace(/\\(.)/g, '$1')
    if (!out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p)
  }
  return out
}

/** GOG: each game is a sub key with `gameName` and `path` values. Returns the path of the Skyrim Special Edition entry. */
export function parseGogSkyrim(out: string): string | undefined {
  for (const block of out.split(/^(?=HKEY_)/m)) {
    const name = parseRegValue(block, 'gameName') ?? ''
    const path = parseRegValue(block, 'path')
    if (path && /skyrim/i.test(name) && /special edition|anniversary/i.test(name)) return path
  }
  return undefined
}

export interface Candidate {
  source: 'manual' | 'steam' | 'gog'
  path: string
}

/** Finds Skyrim SE candidates: manual override first, then every Steam library, then GOG. Only folders that contain SkyrimSE.exe count. */
export async function findSkyrim(o: { manual?: string; exec?: Run; read?: (p: string) => Promise<string>; exists?: (p: string) => boolean }): Promise<Candidate[]> {
  const exec = o.exec ?? run
  const read = o.read ?? ((p) => readFile(p, 'utf8'))
  const exists = o.exists ?? existsSync
  const found: Candidate[] = []
  const add = (source: Candidate['source'], path: string): void => {
    if (exists(join(path, 'SkyrimSE.exe')) && !found.some((f) => f.path.toLowerCase() === path.toLowerCase())) found.push({ source, path })
  }
  if (o.manual) add('manual', o.manual)
  const steam = parseRegValue(await exec('reg', ['query', STEAM_KEY, '/v', 'InstallPath']).catch(() => ''), 'InstallPath')
  if (steam) {
    const vdf = await read(join(steam, 'steamapps', 'libraryfolders.vdf')).catch(() => '')
    for (const lib of parseLibraryFolders(vdf, steam)) add('steam', join(lib, 'steamapps', 'common', SKYRIM_FOLDER))
  }
  const gog = parseGogSkyrim(await exec('reg', ['query', GOG_KEY, '/s']).catch(() => ''))
  if (gog) add('gog', gog)
  return found
}

/** Known SkyrimSE.exe file versions. Anything else is reported as unknown, by family. */
const RUNTIMES: Record<string, string> = {
  '1.5.97.0': 'SE 1.5.97',
  '1.6.317.0': 'AE 1.6.317',
  '1.6.318.0': 'AE 1.6.318',
  '1.6.323.0': 'AE 1.6.323',
  '1.6.342.0': 'AE 1.6.342',
  '1.6.353.0': 'AE 1.6.353',
  '1.6.629.0': 'AE 1.6.629',
  '1.6.640.0': 'AE 1.6.640',
  '1.6.659.0': 'AE 1.6.659',
  '1.6.678.0': 'AE 1.6.678',
  '1.6.1130.0': 'AE 1.6.1130',
  '1.6.1170.0': 'AE 1.6.1170',
  '1.6.1179.0': 'AE 1.6.1179',
  '1.7.104.0': '1.7.104'
}
export function runtimeLabel(version: string): { label: string; known: boolean } {
  const known = RUNTIMES[version]
  if (known) return { label: known, known: true }
  const [maj, min] = version.split('.')
  const family = maj === '1' && min === '5' ? 'SE 1.5.x' : maj === '1' && min === '6' ? 'AE 1.6.x' : maj === '1' && min === '7' ? '1.7.x' : undefined
  return { label: family ? `${family}, version ${version} is not in Inkwell's table` : `unknown runtime ${version}`, known: false }
}

/** File version of an exe (Windows version resource) via PowerShell, so no native module is needed. */
export async function exeVersion(path: string, exec: Run = run): Promise<string | undefined> {
  const script = "$v=(Get-Item -LiteralPath $args[0]).VersionInfo; '{0}.{1}.{2}.{3}' -f $v.FileMajorPart,$v.FileMinorPart,$v.FileBuildPart,$v.FilePrivatePart"
  const out = await exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', `& { ${script} } '${path.replace(/'/g, "''")}'`]).catch(() => '')
  return /^\d+\.\d+\.\d+\.\d+$/m.exec(out)?.[0]
}
