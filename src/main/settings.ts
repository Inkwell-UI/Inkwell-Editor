import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ResolvedSettings, SettingKey, StoredSettings } from '../shared/doctor'

const KEYS: SettingKey[] = ['ffdecDir', 'javaPath', 'papyrusExe', 'creationKitSources', 'skyrimPath', 'figmaManifest', 'mo2ModsDir', 'mo2OverwriteDir', 'mo2ModName']
export const DEFAULT_FFDEC_DIR = 'C:\\Program Files (x86)\\FFDec'
const ENV: Partial<Record<SettingKey, string>> = {
  ffdecDir: 'INKWELL_FFDEC',
  javaPath: 'INKWELL_JAVA',
  papyrusExe: 'INKWELL_PAPYRUS',
  creationKitSources: 'INKWELL_CK_SOURCES',
  skyrimPath: 'INKWELL_SKYRIM',
  figmaManifest: 'INKWELL_FIGMA_MANIFEST',
  mo2ModsDir: 'INKWELL_MO2_MODS',
  mo2OverwriteDir: 'INKWELL_MO2_OVERWRITE'
}

/** Keeps only known keys with a non-empty string value (paths and names have no other valid shape); everything else is dropped. */
export function validateSettings(raw: unknown): StoredSettings {
  const out: StoredSettings = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const r = raw as Record<string, unknown>
  for (const k of KEYS) {
    const v = r[k]
    if (typeof v === 'string' && v.trim() && !/[\0\r\n]/.test(v)) out[k] = v.trim()
  }
  if (r['doctorSeen'] === true) out.doctorSeen = true
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

export async function saveSettings(file: string, s: StoredSettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(validateSettings(s), null, 2) + '\n')
  await rename(tmp, file)
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
