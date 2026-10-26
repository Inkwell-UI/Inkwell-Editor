import type { Swf } from '@inkwell-ui/spec'
import type { GenerateOptions } from '../swf/generate'
import type { LintIssue } from '../swf/lint'
import { readLocalization } from '../project/localizationFile'
import { readFonts, readFontBytes } from '../project/fontFiles'
import { analyzeFont, fontIssues, fontUses, planFont, type FontInfo } from './embed'

/** What one build of one SWF needs for its embedded custom fonts (SPEC-CHANGES V5). */
export interface EmbeddedBuild {
  /** `GenerateOptions.embeddedFonts`; absent when no layer of the SWF uses an embedded font. */
  option?: NonNullable<GenerateOptions['embeddedFonts']>
  /** `CompileOptions.embeddedFontBytes`. */
  bytes: (hash: string) => Buffer | undefined
  /** Licence, missing-glyph and size findings (lint codes of V10); the build report shows them next to the compile lint. */
  issues: LintIssue[]
}

const parsed = new Map<string, { bytes: Buffer; info: FontInfo }>() // font files are immutable by hash; shortcut: unbounded, a project holds a handful

/**
 * Reads the project's `fonts.json`, font files and `localization.json` and plans the characters of every embedded font the SWF's layers use: the characters of the layers and of their
 * translations, plus the font's charsets and extra characters, limited to what the font maps. A layer whose font file is missing gets no entry (the compiler reports `font-file-missing`).
 */
export async function embeddedFontsFor(dir: string, swfName: string, ir: Swf, overlay: Record<string, Record<string, unknown>> | undefined): Promise<EmbeddedBuild> {
  const uses = fontUses(swfName, ir, overlay)
  if (!uses.size) return { bytes: () => undefined, issues: [] }
  const [{ fonts }, { localization }] = await Promise.all([readFonts(dir), readLocalization(dir)])
  const byNode: Record<string, string> = {}
  const planned: NonNullable<GenerateOptions['embeddedFonts']>['fonts'] = {}
  const issues: LintIssue[] = []
  for (const [hash, list] of uses) {
    for (const u of list) byNode[u.nodeId] = hash
    const entry = fonts.find((f) => f.hash === hash)
    let hit = parsed.get(hash)
    if (!hit) {
      const bytes = await readFontBytes(dir, hash)
      if (bytes) {
        try {
          hit = { bytes, info: analyzeFont(bytes) }
          parsed.set(hash, hit)
        } catch {
          hit = undefined
        }
      }
    }
    if (!hit) continue // missing or unreadable: font-file-missing from the compiler
    const plan = planFont(hash, hit.info, { charsets: entry?.charsets ?? ['basicLatin', 'latin1'], extraChars: entry?.extraChars ?? '' }, list, localization)
    planned[hash] = { family: hit.info.family, lineHeight: hit.info.lineHeight, chars: plan.chars }
    for (const i of fontIssues(hit.info, plan, list)) issues.push({ severity: i.severity, code: i.code, message: i.message, nodeId: i.nodeId, nodeName: ir.nodes[i.nodeId]?.name ?? i.nodeId })
  }
  return { option: { byNode, fonts: planned }, bytes: (h) => parsed.get(h)?.bytes, issues }
}
