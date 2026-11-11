import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeAtomic } from '../deploy/write'
import { Slices } from '@inkwell-ui/spec'
import { stableStringify } from './index'
import { exclusive } from './lock'

// `slices.json` at the project root (PLAN-SLICING.md): the Spec's `Slices`, 9-slice / 3-slice insets by image hash. Editor-owned (Figma cannot express a slice); unknown keys survive (loose schema), bytes are stable.

const fileOf = (project: string): string => join(project, 'slices.json')

/** `slices` undefined = no file; `error` = the file exists but is unreadable, and must not be overwritten blindly. */
export async function readSlices(project: string): Promise<{ slices?: Slices; error?: string }> {
  let text: string
  try {
    text = await readFile(fileOf(project), 'utf8')
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? {} : { error: e instanceof Error ? e.message : String(e) }
  }
  try {
    const p = Slices.safeParse(JSON.parse(text.replace(/^﻿/, '')))
    return p.success ? { slices: p.data } : { error: `slices.json: ${p.error.issues[0]?.path.join('.') || 'file'}: ${p.error.issues[0]?.message ?? 'invalid'}` }
  } catch (e) {
    return { error: `slices.json: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Validates against the Spec schema and writes `slices.json`. Refused while an unreadable file sits there. */
export function writeSlices(project: string, doc: unknown): Promise<{ ok: true; slices: Slices } | { ok: false; error: string }> {
  const p = Slices.safeParse(doc)
  if (!p.success) return Promise.resolve({ ok: false, error: `${p.error.issues[0]?.path.join('.') || 'slices'}: ${p.error.issues[0]?.message ?? 'invalid'}` })
  return exclusive(async () => {
    const cur = await readSlices(project)
    if (cur.error) return { ok: false, error: `slices.json could not be read (${cur.error}); fix or delete it first.` } as const
    try {
      await writeAtomic(fileOf(project), stableStringify(p.data))
      return { ok: true, slices: p.data } as const
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) } as const
    }
  })
}
