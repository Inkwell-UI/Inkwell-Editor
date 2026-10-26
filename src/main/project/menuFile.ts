import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MenuSettings } from '@inkwell-ui/spec'
import { stableStringify } from './index'
import { exclusive } from './lock'

// swfs/<name>/menu.json (S9): the author's menu settings, the Spec's MenuSettings. Unknown keys survive (the schema is loose); bytes are stable (sorted keys).

const SAFE_NAME = /^[A-Za-z0-9._-]+$/
const fileOf = (project: string, swf: string): string => {
  if (!SAFE_NAME.test(swf) || swf === '.' || swf === '..') throw new Error(`Invalid swf name "${swf}"`)
  return join(project, 'swfs', swf, 'menu.json')
}

/** The bytes of a menu.json: sorted keys, 2-space indent, trailing newline. */
export const menuText = (m: MenuSettings): string => stableStringify(m)

/** `settings` undefined = the SWF has no menu.json (defaults apply); `error` = the file exists but is unreadable, and must not be overwritten blindly. */
export async function readMenuSettings(project: string, swf: string): Promise<{ settings?: MenuSettings; error?: string }> {
  let text: string
  try {
    text = await readFile(fileOf(project, swf), 'utf8')
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? {} : { error: e instanceof Error ? e.message : String(e) }
  }
  try {
    const p = MenuSettings.safeParse(JSON.parse(text))
    return p.success ? { settings: p.data } : { error: `menu.json: ${p.error.issues[0]?.path.join('.') || 'file'}: ${p.error.issues[0]?.message ?? 'invalid'}` }
  } catch (e) {
    return { error: `menu.json: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Unlocked write, for callers already inside `exclusive`. */
export async function writeMenuLocked(project: string, swf: string, m: MenuSettings): Promise<void> {
  const f = fileOf(project, swf)
  await mkdir(join(project, 'swfs', swf), { recursive: true })
  await writeFile(f, menuText(m))
}

/** Validates against the Spec schema and writes `swfs/<swf>/menu.json`. */
export function writeMenuSettings(project: string, swf: string, doc: unknown): Promise<{ ok: true; settings: MenuSettings } | { ok: false; error: string }> {
  const p = MenuSettings.safeParse(doc)
  if (!p.success) return Promise.resolve({ ok: false, error: `${p.error.issues[0]?.path.join('.') || 'menu'}: ${p.error.issues[0]?.message ?? 'invalid'}` })
  return exclusive(async () => {
    try {
      await writeMenuLocked(project, swf, p.data)
      return { ok: true, settings: p.data } as const
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) } as const
    }
  })
}
