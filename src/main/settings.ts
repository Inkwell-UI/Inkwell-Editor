import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import type { DevLinkSettings, PathSettingKey, ResolvedSettings, SettingKey, StoredSettings } from '../shared/doctor'

const KEYS: SettingKey[] = ['ffdecDir', 'javaPath', 'papyrusExe', 'creationKitSources', 'skyrimPath', 'figmaManifest', 'mo2ModsDir', 'mo2OverwriteDir', 'mo2ModName']
export const DEFAULT_FFDEC_DIR = 'C:\\Program Files (x86)\\FFDec'
export const ENV: Partial<Record<SettingKey, string>> = {
  ffdecDir: 'INKWELL_FFDEC',
  javaPath: 'INKWELL_JAVA',
  papyrusExe: 'INKWELL_PAPYRUS',
  creationKitSources: 'INKWELL_CK_SOURCES',
  skyrimPath: 'INKWELL_SKYRIM',
  figmaManifest: 'INKWELL_FIGMA_MANIFEST',
  mo2ModsDir: 'INKWELL_MO2_MODS',
  mo2OverwriteDir: 'INKWELL_MO2_OVERWRITE'
}

/** Trimmed, one pair of surrounding quotes removed (Explorer's "Copy as path" adds them); undefined when empty or holding control characters. */
export function normalizeValue(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  let t = v.trim()
  if (t.length > 1 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1).trim()
  return t && !/[\0\r\n]/.test(t) ? t : undefined
}

/** Keeps only known keys with a non-empty string value (paths and names have no other valid shape); everything else is dropped. */
export function validateSettings(raw: unknown): StoredSettings {
  const out: StoredSettings = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const r = raw as Record<string, unknown>
  for (const k of KEYS) {
    const n = normalizeValue(r[k])
    if (n) out[k] = n
  }
  if (r['doctorSeen'] === true) out.doctorSeen = true
  if (Array.isArray(r['figmaPlugins'])) {
    const hs = [...new Set(r['figmaPlugins'].filter((x): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)))].slice(0, 256)
    if (hs.length) out.figmaPlugins = hs
  }
  const dl = r['devLinks']
  if (dl && typeof dl === 'object' && !Array.isArray(dl)) {
    const m: Record<string, DevLinkSettings> = {}
    for (const [k, v] of Object.entries(dl)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue
      const x = v as Record<string, unknown>
      const e: DevLinkSettings = {}
      if (typeof x['token'] === 'string' && /^[0-9a-f]{64}$/.test(x['token'])) e.token = x['token']
      if (typeof x['pasted'] === 'string' && /^[0-9a-f]{64}$/.test(x['pasted'])) e.pasted = x['pasted']
      if (typeof x['port'] === 'number' && Number.isInteger(x['port']) && x['port'] >= 1024 && x['port'] <= 65535) e.port = x['port']
      if (x['deploy'] === true) e.deploy = true
      if (Object.keys(e).length) m[k] = e
    }
    if (Object.keys(m).length) out.devLinks = m
  }
  const dc = r['deployConfirmed']
  if (dc && typeof dc === 'object' && !Array.isArray(dc)) {
    const m: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(dc)) if (Array.isArray(v)) m[k] = v.filter((x): x is string => typeof x === 'string')
    out.deployConfirmed = m
  }
  return out
}

/** Stored value, overridden by `INKWELL_*` environment variables, else the default. */
export function resolveSettings(stored: StoredSettings, env: NodeJS.ProcessEnv = process.env): ResolvedSettings {
  const r: ResolvedSettings = { ffdecDir: DEFAULT_FFDEC_DIR, javaPath: 'java', source: { ffdecDir: 'default', javaPath: 'default' } }
  const set = r as unknown as Record<string, string | undefined>
  for (const k of KEYS) {
    const e = ENV[k] ? env[ENV[k]!] : undefined
    if (e) {
      set[k] = e
      r.source[k] = 'env'
    } else if (stored[k]) {
      set[k] = stored[k]
      r.source[k] = 'settings'
    }
  }
  return r
}

/** A missing or damaged file is "no settings" (the editor must start); a write failure is thrown. */
export async function loadSettings(file: string): Promise<StoredSettings> {
  try {
    return validateSettings(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    return {}
  }
}

let tmpSeq = 0
/** Temp file + rename. The temp name is unique per call (two overlapping saves must not share one) and the rename is retried, because Windows refuses to replace a file another process (antivirus, indexer) has open for a moment. */
export async function saveSettings(file: string, s: StoredSettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`
  await writeFile(tmp, JSON.stringify(validateSettings(s), null, 2) + '\n')
  for (let i = 0; ; i++) {
    try {
      return await rename(tmp, file)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await unlink(tmp).catch(() => undefined)
        throw e
      }
      await new Promise((r) => setTimeout(r, 40 * (i + 1)))
    }
  }
}

/** Applies a patch (null removes a key), validated. */
export function patchSettings(cur: StoredSettings, patch: Partial<Record<SettingKey, string | null>>): StoredSettings {
  const next: Record<string, unknown> = { ...cur }
  for (const k of KEYS) {
    if (!(k in patch)) continue
    if (patch[k] === null) delete next[k]
    else next[k] = patch[k]
  }
  return validateSettings(next)
}

/** A mod folder name must be one folder name: no separators, no reserved characters, not . or .., no trailing dot or space. */
export function modNameProblem(name: string): string | undefined {
  if (/[\\/]/.test(name)) return 'The mod name is one folder name inside the mods directory, not a path (no \\ or /).'
  if (/[:*?"<>|]/.test(name)) return 'The mod name has a character Windows does not allow in folder names (: * ? " < > |).'
  if (name === '.' || name === '..') return 'The mod name cannot be . or ..'
  if (/[. ]$/.test(name)) return 'The mod name cannot end with a dot or a space.'
  return undefined
}

/** Why a value is refused outright (nothing is stored), or undefined. Shape only; whether the path exists is `inspectSetting`, which does not refuse (the check row shows it). */
export function refuseReason(key: SettingKey, value: string): string | undefined {
  const n = normalizeValue(value)
  if (n === undefined) return 'Enter a value without line breaks, or use Clear to remove the setting.'
  return key === 'mo2ModName' ? modNameProblem(n) : undefined
}

const KINDS: Record<PathSettingKey, { folder: boolean; what: string; exts?: string[]; contains?: [string, string] }> = {
  ffdecDir: { folder: true, what: 'the FFDec folder', contains: ['lib/ffdec_lib.jar', 'FFDec install (it has no lib\\ffdec_lib.jar)'] },
  javaPath: { folder: false, what: 'java.exe', exts: ['.exe', '.cmd', '.bat', '.com'] },
  papyrusExe: { folder: false, what: 'papyrus.exe', exts: ['.exe'] },
  creationKitSources: { folder: true, what: 'the Creation Kit sources folder' },
  skyrimPath: { folder: true, what: 'the Skyrim folder', contains: ['SkyrimSE.exe', 'Skyrim Special Edition folder (it has no SkyrimSE.exe)'] },
  figmaManifest: { folder: false, what: 'the plugin manifest.json', exts: ['.json'] },
  mo2ModsDir: { folder: true, what: 'the MO2 mods directory' },
  mo2OverwriteDir: { folder: true, what: 'the MO2 overwrite folder' }
}

/** Says what is wrong with a stored value (does not exist, a file instead of a folder, not an executable, wrong kind of folder), or undefined when it is usable. A bare command such as `java` is looked up on PATH by its check, so it is not inspected. */
export async function inspectSetting(key: SettingKey, value: string): Promise<string | undefined> {
  if (key === 'mo2ModName') return modNameProblem(value)
  const k = KINDS[key]
  if (key === 'javaPath' && !/[\\/]/.test(value)) return undefined
  const st = await stat(value).catch(() => undefined)
  if (!st) return `${value} does not exist.`
  if (k.folder && !st.isDirectory()) return `${value} is a file, not a folder. Choose ${k.what}.`
  if (!k.folder && st.isDirectory()) return `${value} is a folder, not a file. Choose ${k.what}.`
  if (k.exts && !k.exts.includes(extname(value).toLowerCase())) return `${value} is not ${k.what} (expected a ${k.exts[0]} file).`
  if (k.contains && !(await stat(join(value, k.contains[0])).catch(() => undefined))) return `${value} is not a ${k.contains[1]}.`
  return undefined
}

/** `inspectSetting` for every value that is set explicitly (stored or from the environment; the environment value is the one in use). */
export async function settingProblems(r: ResolvedSettings): Promise<NonNullable<ResolvedSettings['problems']>> {
  const out: NonNullable<ResolvedSettings['problems']> = {}
  const rec = r as unknown as Record<string, string | undefined>
  await Promise.all(
    KEYS.map(async (k) => {
      const v = rec[k]
      const p = v && r.source[k] !== 'default' ? await inspectSetting(k, v).catch(() => undefined) : undefined
      if (p) out[k] = p
    })
  )
  return out
}
