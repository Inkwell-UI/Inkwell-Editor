import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeAtomic } from '../deploy/write'
import { analyzeFont, DEFAULT_CHARSETS, fontHash, isCharsetId, isFontHash, type FontInfo, type FontSettings } from '../fonts/embed'
import { stableStringify } from './index'
import { exclusive } from './lock'

// The project's embedded fonts (SPEC-CHANGES V5.1): the files at `fonts/<hash>.ttf` and their settings in `fonts.json` (editor-owned, not the IR). A font is a project asset
// keyed by the first 40 hex digits of its SHA-256. The editor never commits a font anywhere; the owner adds the file to the project by hand and sees the licence warning.

const Entry = z.looseObject({
  family: z.string(),
  /** The file name the author picked, for the table. */
  source: z.string().optional(),
  charsets: z.array(z.string()).default([...DEFAULT_CHARSETS]),
  extraChars: z.string().default('')
})
export const FontsDoc = z.looseObject({ fonts: z.record(z.string(), Entry).default({}) })
export type FontsDoc = z.infer<typeof FontsDoc>
export type ProjectFont = FontSettings & { hash: string; family: string; source?: string }

const docFile = (dir: string): string => join(dir, 'fonts.json')
const fontFile = (dir: string, hash: string): string => {
  if (!isFontHash(hash)) throw new Error(`"${hash}" is not a font hash.`)
  return join(dir, 'fonts', `${hash}.ttf`)
}

const toFont = (hash: string, e: FontsDoc['fonts'][string]): ProjectFont => ({
  hash, family: e.family, ...(e.source ? { source: e.source } : {}), charsets: e.charsets.filter(isCharsetId), extraChars: e.extraChars
})

/** The project's fonts. `error` = fonts.json exists but is unreadable (it is never overwritten). */
export async function readFonts(dir: string): Promise<{ fonts: ProjectFont[]; error?: string }> {
  let text: string
  try {
    text = await readFile(docFile(dir), 'utf8')
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { fonts: [] } : { fonts: [], error: e instanceof Error ? e.message : String(e) }
  }
  const p = FontsDoc.safeParse(safeJson(text))
  if (!p.success) return { fonts: [], error: `fonts.json: ${p.error.issues[0]?.path.join('.') || 'file'}: ${p.error.issues[0]?.message ?? 'invalid'}` }
  return { fonts: Object.entries(p.data.fonts).filter(([h]) => isFontHash(h)).map(([h, e]) => toFont(h, e)) }
}
const safeJson = (t: string): unknown => {
  try {
    return JSON.parse(t.replace(/^﻿/, ''))
  } catch {
    return undefined
  }
}

/** The font file's bytes, or undefined when it is missing. */
export const readFontBytes = (dir: string, hash: string): Promise<Buffer | undefined> => readFile(fontFile(dir, hash)).then((b) => b, () => undefined)

async function readDoc(dir: string): Promise<{ doc: FontsDoc } | { error: string }> {
  let text: string
  try {
    text = await readFile(docFile(dir), 'utf8')
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { doc: FontsDoc.parse({}) } : { error: e instanceof Error ? e.message : String(e) }
  }
  const p = FontsDoc.safeParse(safeJson(text))
  return p.success ? { doc: p.data } : { error: 'fonts.json is not valid' }
}

export type AddFontResult = { ok: true; font: ProjectFont; info: FontInfo; existed: boolean } | { ok: false; error: string }

/** Validates a TrueType file, stores it as `fonts/<hash>.ttf` and lists it in fonts.json with the default charsets. Adding a font that is already there changes nothing. */
export function addFont(dir: string, bytes: Buffer, source?: string): Promise<AddFontResult> {
  let info: FontInfo
  try {
    info = analyzeFont(bytes)
  } catch (e) {
    return Promise.resolve({ ok: false, error: `${source ?? 'The file'} is not a usable TrueType font: ${e instanceof Error ? e.message : String(e)}` })
  }
  const hash = fontHash(bytes)
  return exclusive(async (): Promise<AddFontResult> => {
    const cur = await readDoc(dir)
    if ('error' in cur) return { ok: false, error: `fonts.json could not be read (${cur.error}); fix or delete it first.` }
    const existing = cur.doc.fonts[hash]
    if (existing) return { ok: true, font: toFont(hash, existing), info, existed: true }
    await writeAtomic(fontFile(dir, hash), bytes)
    const entry = Entry.parse({ family: info.family, ...(source ? { source } : {}) })
    await writeAtomic(docFile(dir), Buffer.from(stableStringify({ ...cur.doc, fonts: { ...cur.doc.fonts, [hash]: entry } })))
    return { ok: true, font: toFont(hash, entry), info, existed: false }
  })
}

/** Changes the charsets and extra characters of a font in the project. Unknown hashes are refused. */
export function saveFontSettings(dir: string, hash: string, settings: FontSettings): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isFontHash(hash)) return Promise.resolve({ ok: false, error: `"${hash}" is not a font hash.` })
  return exclusive(async () => {
    const cur = await readDoc(dir)
    if ('error' in cur) return { ok: false, error: `fonts.json could not be read (${cur.error}); fix or delete it first.` } as const
    const e = cur.doc.fonts[hash]
    if (!e) return { ok: false, error: 'No such font in the project.' } as const
    const next = Entry.parse({ ...e, charsets: settings.charsets.filter(isCharsetId), extraChars: settings.extraChars })
    await writeAtomic(docFile(dir), Buffer.from(stableStringify({ ...cur.doc, fonts: { ...cur.doc.fonts, [hash]: next } })))
    return { ok: true } as const
  })
}
