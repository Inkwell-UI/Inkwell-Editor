import type { CsvImport, Localization } from '@inkwell-ui/spec'

// Edits of `localization.json` as pure functions (SPEC-CHANGES V2 to V4): the Localization tab, the Inspector's key field and the CSV import use them,
// the main process saves the result. Every function returns a new document; unknown keys of the document and of every row survive.

type Row = Record<string, string>

/** The row of `key`, matched ignoring case (the engine does); returns the stored spelling of the key. */
const find = (l: Localization, key: string): { key: string; row: Row } | undefined => {
  const lower = key.toLowerCase()
  const k = Object.keys(l.entries).find((x) => x.toLowerCase() === lower)
  return k === undefined ? undefined : { key: k, row: l.entries[k]! }
}

/** Creates the row of `key` with the source text if it does not exist; an existing row keeps its texts (the source text is only filled in when empty). */
export function ensureKey(l: Localization, key: string, sourceText: string): Localization {
  const f = find(l, key)
  if (!f) return { ...l, entries: { ...l.entries, [key]: { [l.source]: sourceText } } }
  if ((f.row[l.source] ?? '') !== '' || sourceText === '') return l
  return { ...l, entries: { ...l.entries, [f.key]: { ...f.row, [l.source]: sourceText } } }
}

/** Sets one cell; an empty text removes the cell (the language then falls back to the source text). */
export function setCell(l: Localization, key: string, language: string, text: string): Localization {
  const f = find(l, key)
  const base = f?.row ?? {}
  const row: Row = { ...base }
  if (text === '') delete row[language]
  else row[language] = text
  return { ...l, entries: { ...l.entries, [f?.key ?? key]: row } }
}

export function removeKey(l: Localization, key: string): Localization {
  const f = find(l, key)
  if (!f) return l
  const { [f.key]: _gone, ...rest } = l.entries
  return { ...l, entries: rest }
}

/** Moves a row to a new key (a layer's key was edited). Refused (returns the same document) when `to` already has a row other than `from`'s. */
export function renameKey(l: Localization, from: string, to: string): Localization {
  const a = find(l, from)
  const b = find(l, to)
  if (!a || (b && b.key !== a.key)) return l
  const { [a.key]: row, ...rest } = l.entries
  return { ...l, entries: { ...rest, [to]: row! } }
}

export function addLanguage(l: Localization, language: string): Localization {
  return l.languages.includes(language) ? l : { ...l, languages: [...l.languages, language] }
}

/** Removes a language and its cells. The source language cannot be removed. */
export function removeLanguage(l: Localization, language: string): Localization {
  if (language === l.source || !l.languages.includes(language)) return l
  const entries = Object.fromEntries(Object.entries(l.entries).map(([k, row]) => [k, Object.fromEntries(Object.entries(row).filter(([lang]) => lang !== language))]))
  return { ...l, languages: l.languages.filter((x) => x !== language), entries }
}

export interface CsvMergeReport {
  languagesAdded: string[]
  keysAdded: number
  cellsChanged: number
  cellsAdded: number
  /** CSV rows for keys the project does not have are added as rows (a translator may add a key); counted in keysAdded. */
  issues: string[]
}

/** What importing `imp` would do, and the resulting document. Cells present in the CSV overwrite; cells absent or empty in the CSV are left alone; nothing is ever deleted. */
export function mergeCsv(l: Localization, imp: CsvImport): { localization: Localization; report: CsvMergeReport } {
  let out = l
  const report: CsvMergeReport = { languagesAdded: [], keysAdded: 0, cellsChanged: 0, cellsAdded: 0, issues: [...imp.issues] }
  for (const lang of imp.languages)
    if (!out.languages.includes(lang)) {
      out = addLanguage(out, lang)
      report.languagesAdded.push(lang)
    }
  for (const [key, row] of Object.entries(imp.entries)) {
    if (!find(out, key)) {
      report.keysAdded++
      out = { ...out, entries: { ...out.entries, [key]: {} } }
    }
    for (const [lang, text] of Object.entries(row)) {
      const old = find(out, key)!.row[lang]
      if (old === text) continue
      if (old === undefined || old === '') report.cellsAdded++
      else report.cellsChanged++
      out = setCell(out, key, lang, text)
    }
  }
  return { localization: out, report }
}
