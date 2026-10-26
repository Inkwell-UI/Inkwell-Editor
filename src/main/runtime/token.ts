import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { TokenSource } from '../../shared/devLink'
import type { DevLinkSettings, StoredSettings } from '../../shared/doctor'
import { readDevIni, RUNTIME_INI_REL } from './devIni'
import type { DevConfig } from './client'

export const DEFAULT_PORT = 8788

/**
 * Which token and port the connection uses (S6.3, UX 4.6). Order: a token the user pasted; the `Inkwell.ini` in the MO2 overwrite folder (MO2's virtual file system gives it
 * priority over a mod folder, and it is where the runtime writes a token it made itself); the `Inkwell.ini` of the deploy target; the token the editor generated for this project.
 * The first INI that has a token wins. The port comes from the same INI when it has one, else the stored port, else 8788.
 */
export async function resolveDevConfig(o: { link?: DevLinkSettings; overwriteDir?: string; deployRoot?: string }): Promise<DevConfig | undefined> {
  const port = o.link?.port ?? DEFAULT_PORT
  if (o.link?.pasted) return { token: o.link.pasted, port, source: 'pasted' }
  const fromIni = async (dir: string | undefined, source: TokenSource): Promise<DevConfig | undefined> => {
    if (!dir) return undefined
    const file = join(dir, ...RUNTIME_INI_REL.split('/'))
    const text = await readFile(file, 'utf8').catch(() => undefined)
    const d = text ? readDevIni(text) : undefined
    return d?.token ? { token: d.token, port: d.port ?? port, source, from: file } : undefined
  }
  return (await fromIni(o.overwriteDir, 'overwrite')) ?? (await fromIni(o.deployRoot, 'deploy')) ?? (o.link?.token ? { token: o.link.token, port, source: 'editor' } : undefined)
}

/** The project's dev token in the user settings (`devLinks`, key = lower-case project folder, as the session keys it): an existing token is kept, else `make()` is stored. Used by `deploy:menu-nodes --dev`. */
export function withDevToken(s: StoredSettings, projectDir: string, make: () => string, port = DEFAULT_PORT): { settings: StoredSettings; token: string } {
  const k = resolve(projectDir).toLowerCase()
  const cur = s.devLinks?.[k] ?? {}
  const token = cur.token ?? make()
  return { token, settings: { ...s, devLinks: { ...s.devLinks, [k]: { ...cur, token, port: cur.port ?? port } } } }
}
