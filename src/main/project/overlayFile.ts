import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Overlay } from '@inkwell-ui/spec'
import { normalizeOverlay, overlayProblems } from '../../shared/overlay'
import type { SaveOverlayResult } from '../../shared/ipc'
import { stableStringify } from './index'
import { exclusive } from './lock'

/** Swf folder names are produced by the sync server (`A-Za-z0-9._-`); anything else could escape the project folder. */
const SAFE_NAME = /^[A-Za-z0-9._-]+$/

/**
 * Validates and writes `swfs/<swfName>/overlay.json` (sorted keys, 2-space indent). The document is checked against the spec's Overlay schema
 * (loose: unknown keys survive) and every instanceName must be an identifier. The visual IR is never touched.
 */
export function writeOverlay(projectDir: string, swfName: string, doc: unknown): Promise<SaveOverlayResult> {
  if (!SAFE_NAME.test(swfName) || swfName === '.' || swfName === '..') return Promise.resolve({ ok: false, error: `Invalid swf name "${swfName}"` })
  const problems = overlayProblems(doc)
  if (problems.length) return Promise.resolve({ ok: false, error: problems.join('; ') })
  const full = normalizeOverlay(doc as Record<string, unknown>)
  const parsed = Overlay.safeParse(full)
  if (!parsed.success) return Promise.resolve({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid overlay' })
  return exclusive(async () => {
    const dir = join(projectDir, 'swfs', swfName)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'overlay.json'), stableStringify(full))
    return { ok: true } as const
  })
}
