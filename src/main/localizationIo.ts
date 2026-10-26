import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { entriesFor, fromCsv, toCsv, translationPath, writeTranslationFile, type Localization } from '@inkwell-ui/spec'
import { mergeCsv, type CsvMergeReport } from '../shared/localizationOps'

// File side of the Localization tab (SPEC-CHANGES V3): CSV for translators and the Skyrim translation files. The dialogs live in index.ts; these functions are what they call.

/** UTF-8 with a BOM, CRLF (what Excel opens correctly). */
export async function exportCsvFile(path: string, loc: Localization): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, toCsv(loc))
}

/** Reads a CSV and merges it into `loc`; nothing is written here (the caller confirms the report first, then saves). */
export async function readCsvImport(path: string, loc: Localization): Promise<{ localization: Localization; report: CsvMergeReport }> {
  return mergeCsv(loc, fromCsv(await readFile(path, 'utf8')))
}

/** One `Interface/Translations/<modId>_<LANGUAGE>.txt` per language under `dir` (the same bytes a deploy writes). Returns the relative paths. */
export async function exportTranslationFiles(dir: string, modId: string, loc: Localization): Promise<string[]> {
  const out: string[] = []
  for (const lang of loc.languages) {
    const rel = translationPath(modId, lang)
    const full = join(dir, ...rel.split('/'))
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, writeTranslationFile(entriesFor(loc, lang).entries))
    out.push(rel)
  }
  return out
}
