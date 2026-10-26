import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Localization, SPEC_VERSION } from '@inkwell-ui/spec'
import { stableStringify } from './index'
import { exclusive } from './lock'

// `localization.json` at the project root (SPEC-CHANGES V2.3): the Spec's `Localization`. Unknown keys survive (the schema is loose); bytes are stable (sorted keys).

const fileOf = (project: string): string => join(project, 'localization.json')

/** The bytes of a localization.json: sorted keys, 2-space indent, trailing newline. */
export const localizationText = (l: Localization): string => stableStringify(l)

/** A new table for a project: the namespace `Inkwell_<modId>`, English only. */
export const defaultLocalization = (modId: string): Localization =>
  Localization.parse({ specVersion: SPEC_VERSION, namespace: `Inkwell_${modId.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 64), source: 'ENGLISH', languages: ['ENGLISH'], entries: {} })

/** `localization` undefined = no file (the tab shows the defaults); `error` = the file exists but is unreadable, and must not be overwritten blindly. */
export async function readLocalization(project: string): Promise<{ localization?: Localization; error?: string }> {
  let text: string
  try {
    text = await readFile(fileOf(project), 'utf8')
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? {} : { error: e instanceof Error ? e.message : String(e) }
  }
  try {
    const p = Localization.safeParse(JSON.parse(text.replace(/^﻿/, '')))
    return p.success ? { localization: p.data } : { error: `localization.json: ${p.error.issues[0]?.path.join('.') || 'file'}: ${p.error.issues[0]?.message ?? 'invalid'}` }
  } catch (e) {
    return { error: `localization.json: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Validates against the Spec schema and writes `localization.json`. Refused while an unreadable file sits there. */
export function writeLocalization(project: string, doc: unknown): Promise<{ ok: true; localization: Localization } | { ok: false; error: string }> {
  const p = Localization.safeParse(doc)
  if (!p.success) return Promise.resolve({ ok: false, error: `${p.error.issues[0]?.path.join('.') || 'localization'}: ${p.error.issues[0]?.message ?? 'invalid'}` })
  return exclusive(async () => {
    const cur = await readLocalization(project)
    if (cur.error) return { ok: false, error: `localization.json could not be read (${cur.error}); fix or delete it first.` } as const
    try {
      await writeFile(fileOf(project), localizationText(p.data))
      return { ok: true, localization: p.data } as const
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) } as const
    }
  })
}
