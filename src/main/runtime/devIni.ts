import { randomBytes } from 'node:crypto'
import { parseIni, writeIni, RuntimeToken } from '@inkwell-ui/spec'

// The runtime-wide `Inkwell.ini` a Dev deploy writes (SPEC-CHANGES S2/S6, O5): `[Dev] DevMode=1`, `Token=<64 hex>`, `Port`. Built on the Spec's `parseIni` / `writeIni`.

/** Deploy-relative path of the runtime-wide INI (next to the per-mod `<modId>.ini`). */
export const RUNTIME_INI_REL = 'SKSE/Plugins/Inkwell/Inkwell.ini'

/** How many reload copies of a menu's SWF a Dev deploy ships (the runtime's DEV_SLOTS). */
export const DEV_RELOAD_SLOTS = 16
/**
 * Deploy-relative paths of a menu's reload copies. The engine caches a loaded movie by name and only finds loose files that existed when the game started,
 * so each hot reload loads the next of these (the runtime overwrites its content first). Name rule = the runtime's DevBare.
 */
export const devReloadPaths = (menuName: string): string[] => {
  const key = menuName.toLowerCase().replace(/[^a-z0-9]/g, '_')
  return Array.from({ length: DEV_RELOAD_SLOTS }, (_, i) => `Interface/Inkwell/_dev/${key}_${i}.swf`)
}

/** 256 random bits as 64 lower-case hex digits (S6.3). */
export const generateToken = (): string => randomBytes(32).toString('hex')

/** Accepts what a user pastes (surrounding space or quotes, upper case) and returns the token in its canonical form, or undefined. */
export function normalizeToken(raw: string): string | undefined {
  const t = raw.trim().replace(/^["']|["']$/g, '').trim().toLowerCase()
  return RuntimeToken.safeParse(t).success ? t : undefined
}

/**
 * The new text of `Inkwell.ini` for a Dev deploy. Keeps what the file already says (LogLevel, Watch, any `[Menu.*]`) through the Spec parser and sets DevMode, Port and Token.
 * shortcut: the Spec writer drops comments and keys it does not know; fine for a file the editor and the runtime own, revisit if users hand-edit it.
 */
export function devIniText(existing: string | undefined, dev: { token: string; port: number }): string {
  const cur = existing ? parseIni(existing, 'runtime').ini : { menus: {}, widgets: {} }
  return writeIni({ ...cur, dev: { ...cur.dev, devMode: true, port: dev.port, token: dev.token } })
}

/** The `[Dev]` values of an existing `Inkwell.ini` (what the connection reads when the editor did not make the token). */
export function readDevIni(text: string): { token?: string; port?: number } {
  const d = parseIni(text, 'runtime').ini.dev
  return { ...(d?.token ? { token: d.token } : {}), ...(d?.port ? { port: d.port } : {}) }
}
