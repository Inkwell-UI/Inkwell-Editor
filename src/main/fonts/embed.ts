import { createHash } from 'node:crypto'
import type { Localization, Swf } from '@inkwell-ui/spec'
import { cmapCodePoints, nameString, readSfnt } from './sfnt'

// Embedded custom fonts (SPEC-CHANGES V5): analysing a font file, the characters a SWF needs from it, the licence gate and the lint. Pure (no electron, no disk): the project
// files are `project/fontFiles.ts`, the compile step is FFDec's `fonts` job (swf/compile.ts), which imports the glyph outlines of exactly `chars` into a DefineFont3.
// Spike S-A (TEST-IN-GAME-0.4.md section 6) proved in game that such a font draws, with accents, and that a character outside the subset draws as an empty box.

import { CHARSETS, isCharsetId, type CharsetId } from '../../shared/fonts'
export { CHARSETS, isCharsetId, type CharsetId }
export const DEFAULT_CHARSETS: readonly CharsetId[] = ['basicLatin', 'latin1']

/** Per-font settings kept in `fonts.json` (not in the IR): the chosen charsets and extra characters. */
export interface FontSettings {
  charsets: CharsetId[]
  extraChars: string
}

/** Warn above this much font data in a SWF; far above it is a CJK-sized font (V5.4). */
export const FONT_SIZE_WARN = 256 * 1024
export const FONT_SIZE_LARGE = 1024 * 1024

export interface FontInfo {
  /** Name ID 1 (family); the DefineFont3 name. */
  family: string
  /** Name ID 4. */
  fullName: string
  fsType: number
  /** Name ID 13 (licence description), when the font has one. */
  licenseText?: string
  /** Characters the font maps (cmap), undefined when unreadable. */
  codePoints: ReadonlySet<number> | undefined
  /** natural line height / em (hhea ascender - descender + lineGap over unitsPerEm). */
  lineHeight: number
  glyphCount: number
  bytes: number
}

/** First 40 hex digits of the SHA-256 of the file: the font's asset hash and file name. */
export const fontHash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex').slice(0, 40)
export const isFontHash = (s: string): boolean => /^[0-9a-f]{40}$/.test(s)

/** Reads what the editor needs from a TrueType font. Throws on anything that is not a TrueType file (OpenType with CFF outlines is refused: FFDec's import needs TrueType). */
export function analyzeFont(bytes: Buffer): FontInfo {
  const t = readSfnt(bytes) // throws "Not a TrueType font" for OTTO and other containers
  const name = t.get('name')
  const os2 = t.get('OS/2')
  const head = t.get('head')
  const hhea = t.get('hhea')
  const maxp = t.get('maxp')
  if (!name || !head || !hhea) throw new Error('The font lacks a name, head or hhea table.')
  const family = nameString(name, 1)?.trim()
  if (!family) throw new Error('The font has no family name.')
  const upm = head.readUInt16BE(18) || 1000
  const lineHeight = (hhea.readInt16BE(4) - hhea.readInt16BE(6) + hhea.readInt16BE(8)) / upm
  const license = nameString(name, 13)
  return {
    family,
    fullName: nameString(name, 4)?.trim() || family,
    fsType: os2 && os2.length >= 10 ? os2.readUInt16BE(8) : 0,
    ...(license ? { licenseText: license.trim() } : {}),
    codePoints: cmapCodePoints(bytes),
    lineHeight: Number.isFinite(lineHeight) && lineHeight > 0.5 && lineHeight < 3 ? lineHeight : 1.2,
    glyphCount: maxp && maxp.length >= 6 ? maxp.readUInt16BE(4) : 0,
    bytes: bytes.length
  }
}

/** `fsType` bits (OpenType OS/2): 0x2 restricted, 0x4 preview and print, 0x8 editable, 0x100 no subsetting, 0x200 bitmap only. */
export function licenseVerdict(fsType: number): { error?: { code: string; text: string }; warning?: { code: string; text: string } } {
  if (fsType & 0x2) return { error: { code: 'font-license-restricted', text: 'its licence flag (fsType) is "restricted": the font may not be embedded' } }
  if (fsType & 0x100) return { error: { code: 'font-license-restricted', text: 'its licence flag forbids subsetting, and Inkwell always embeds a subset' } }
  if (fsType & 0x200) return { error: { code: 'font-license-restricted', text: 'its licence flag allows only embedded bitmaps, and Inkwell embeds outlines' } }
  if (fsType & 0x4) return { warning: { code: 'font-license-restricted-embedding', text: 'its licence flag is "preview & print": embedding in a released mod may not be allowed; check the licence' } }
  if (fsType & 0x8) return { warning: { code: 'font-license-restricted-embedding', text: 'its licence flag is "editable": embedding in a released mod may not be allowed; check the licence' } }
  return {}
}

/** The characters of a charset selection and extra text, as one string of unique code points sorted ascending (printable only; controls and surrogates are dropped). */
export function charsetChars(charsets: readonly string[], extra = ''): string {
  const set = new Set<number>()
  for (const id of charsets) if (isCharsetId(id)) for (const [a, b] of CHARSETS[id].ranges) for (let c = a; c <= b; c++) set.add(c)
  for (const ch of extra) set.add(ch.codePointAt(0)!)
  return [...set].filter((c) => c >= 0x20 && c !== 0x7f && !(c >= 0x80 && c < 0xa0) && !(c >= 0xd800 && c <= 0xdfff)).sort((a, b) => a - b).map((c) => String.fromCodePoint(c)).join('')
}

export interface FontUse {
  /** Figma node id, layer name and SWF of a text layer that uses the font. */
  swf: string
  nodeId: string
  layer: string
  /** Source text of the layer. */
  text: string
  /** Translation key of the layer (overlay `locKey`), when it has one. */
  key?: string
}

export interface FontPlan {
  hash: string
  /** The characters to embed: used by the layers and their translations, plus the charsets and extra chars, limited to what the font maps. Sorted. */
  chars: string
  /** Characters a layer or translation needs that the font does not map (after dropping whitespace): `where` names the layer or key and language. */
  missing: { where: string; chars: string[]; nodeId?: string }[]
  /** Rough size of the font data in the SWF (V5.4): the file size scaled by the share of its glyphs that are embedded. */
  estimatedBytes: number
}

const printable = (c: string): boolean => !/[\s\u0000-\u001f\u007f-\u009f]/.test(c)

/** What one SWF needs from one font. `loc` supplies the translations of the keys the layers use (every language of the table). */
export function planFont(hash: string, info: FontInfo, settings: FontSettings, uses: readonly FontUse[], loc?: Localization): FontPlan {
  const have = info.codePoints
  const wanted = new Set<string>()
  const missing: FontPlan['missing'] = []
  const need = (where: string, text: string, nodeId?: string): void => {
    const lacking: string[] = []
    for (const ch of new Set([...text])) {
      if (!printable(ch)) continue
      wanted.add(ch)
      if (have && !have.has(ch.codePointAt(0)!)) lacking.push(ch)
    }
    if (lacking.length) missing.push({ where, chars: lacking, ...(nodeId ? { nodeId } : {}) })
  }
  for (const u of uses) {
    need(`"${u.layer}"`, u.text, u.nodeId)
    if (u.key && loc) {
      const k = Object.keys(loc.entries).find((x) => x.toLowerCase() === u.key!.toLowerCase())
      if (k) for (const lang of loc.languages) if (lang !== loc.source) need(`${k} in ${lang}`, loc.entries[k]![lang] ?? '', u.nodeId)
    }
  }
  for (const ch of charsetChars(settings.charsets, settings.extraChars)) if (printable(ch) || ch === ' ') wanted.add(ch)
  wanted.add(' ')
  const chars = [...wanted].filter((ch) => !have || have.has(ch.codePointAt(0)!)).sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!).join('')
  const total = Math.max(info.glyphCount, 1)
  return { hash, chars, missing, estimatedBytes: Math.round((info.bytes * Math.min(1, [...chars].length / total)) * 1.1) }
}

export interface EmbedIssue {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  /** A layer that uses the font, so the lint row links to it. */
  nodeId: string
}

/** The lint of one font in one SWF (V5.3 to V5.5, V10). `uses` is non-empty (a font no layer uses is not planned). */
export function fontIssues(info: FontInfo, plan: FontPlan, uses: readonly FontUse[]): EmbedIssue[] {
  const out: EmbedIssue[] = []
  const first = uses[0]!
  const v = licenseVerdict(info.fsType)
  if (v.error) out.push({ severity: 'error', code: v.error.code, nodeId: first.nodeId, message: `"${info.family}" cannot be embedded: ${v.error.text}.` })
  if (v.warning) out.push({ severity: 'warning', code: v.warning.code, nodeId: first.nodeId, message: `"${info.family}": ${v.warning.text}.` })
  for (const m of plan.missing) {
    const shown = m.chars.slice(0, 8).map((c) => `"${c}"`).join(' ')
    out.push({ severity: 'error', code: 'font-subset-missing-glyph', nodeId: m.nodeId ?? first.nodeId, message: `${m.where} uses ${shown}${m.chars.length > 8 ? ` and ${m.chars.length - 8} more` : ''}, which "${info.family}" has no glyph for; the game draws an empty box.` })
  }
  if (plan.estimatedBytes >= FONT_SIZE_LARGE) out.push({ severity: 'warning', code: 'font-size-large', nodeId: first.nodeId, message: `"${info.family}" adds about ${(plan.estimatedBytes / 1048576).toFixed(1)} MB to the SWF (${[...plan.chars].length} glyphs). A CJK font should be limited to the characters the texts need.` })
  else if (plan.estimatedBytes >= FONT_SIZE_WARN) out.push({ severity: 'warning', code: 'font-size-large', nodeId: first.nodeId, message: `"${info.family}" adds about ${Math.round(plan.estimatedBytes / 1024)} KB to the SWF (${[...plan.chars].length} glyphs). Remove unused charsets to make it smaller.` })
  return out
}

/** The text layers of a SWF that use each embedded font (overlay `font` = hash), in layer order. Layers of other node types are ignored. */
export function fontUses(swf: string, ir: Swf, overlay: Record<string, Record<string, unknown>> | undefined): Map<string, FontUse[]> {
  const out = new Map<string, FontUse[]>()
  for (const [id, o] of Object.entries(overlay ?? {})) {
    const hash = o['font']
    const n = ir.nodes[id]
    if (typeof hash !== 'string' || !hash || n?.type !== 'text') continue
    const key = typeof o['locKey'] === 'string' && o['locKey'] ? (o['locKey'] as string) : undefined
    const list = out.get(hash) ?? []
    list.push({ swf, nodeId: id, layer: n.name, text: n.content, ...(key ? { key } : {}) })
    out.set(hash, list)
  }
  return out
}
