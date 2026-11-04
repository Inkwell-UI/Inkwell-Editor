import { useEffect, useMemo, useState } from 'react'
import { SKYRIM_LANGUAGES, type Swf } from '@inkwell-ui/spec'
import { inkwell } from '../hooks/api'
import { useProject } from '../hooks/useProject'
import { keyedTexts, type LocSwf } from '../../shared/localizationLint'
import { addLanguage, removeKey, removeLanguage, setCell } from '../../shared/localizationOps'
import { getOverlayDoc } from '../state/overlayStore'
import { loadSwfGraphs, useGraphDocs } from '../state/graphDocs'
import { findGraphStore, toGraph } from '../state/graphStore'
import { useLocalizationStore } from '../state/localizationStore'
import { useToastStore } from '../state/toastStore'
import { matchesQuery } from '../../shared/filter'
import { strings } from '../../shared/strings'
import { ChevronDown, Trash2 } from 'lucide-react'
import { Btn } from '../ui/Btn'
import { Popover } from '../ui/Popover'
import { SearchBox } from '../ui/SearchBox'
import { TextCell } from '../ui/TextCell'
import { Panel } from './Panel'

/** Zone 6A, tab 2 (UX 4.6): the translation table of the project's keyed text layers (SPEC-CHANGES V2 to V4, V11.1). Cells save at once into localization.json. */
export function LocalizationPanel() {
  const project = useProject()
  const { loaded, localization, error, load, set, create } = useLocalizationStore()
  const [missingOnly, setMissingOnly] = useState(false)
  const [query, setQuery] = useState('')
  const dir = project?.dir

  useEffect(() => void (dir && load()), [dir, load])
  // keyed Set Text nodes of graphs are rows too (V13.2), so every SWF's graphs are loaded (once; the Graph panel shares them)
  useEffect(() => void (project?.swfs ?? []).forEach((s) => inkwell && void loadSwfGraphs(s, inkwell)), [project])
  const graphIds = useGraphDocs((s) => s.ids)

  const swfs: LocSwf[] = useMemo(
    () => (project?.swfs ?? []).map((s) => ({
      name: s.name, kind: s.ir.target.kind, orphaned: s.orphaned, ir: s.ir as Swf, overlay: (getOverlayDoc(s.id)?.nodes ?? s.overlay.nodes ?? {}) as Record<string, Record<string, unknown>>,
      ...(s.menu?.triggers.systemMenu ? { systemMenu: s.menu.triggers.systemMenu } : {}),
      graphs: (graphIds[s.id] ?? []).flatMap((id) => { const g = findGraphStore(s.id, id); return g ? [toGraph(g.getState())] : [] })
    })),
    [project, graphIds]
  )
  const texts = useMemo(() => keyedTexts(swfs), [swfs])

  if (!project) return <Panel title={strings.loc.title}><p className="empty">{strings.loc.noProject}</p></Panel>
  if (error) return <Panel title={strings.loc.title}><p className="empty tone-error">{strings.loc.unreadable(error)}</p></Panel>
  if (!loaded) return <Panel title={strings.loc.title}><p className="empty">…</p></Panel>
  if (!localization) {
    return (
      <Panel title={strings.loc.title}>
        <p className="empty">{strings.loc.noTable}</p>
        <div className="toolbar"><Btn variant="primary" onClick={create} testId="loc-create">{strings.loc.create}</Btn></div>
      </Panel>
    )
  }

  const langs = [localization.source, ...localization.languages.filter((l) => l !== localization.source)]
  const rows = new Map<string, { key: string; layer: string; text: string; graph?: boolean }>()
  for (const t of texts) if (!rows.has(t.key.toLowerCase())) rows.set(t.key.toLowerCase(), { key: t.key, layer: t.layer, text: t.text, ...(t.graph ? { graph: true } : {}) })
  for (const k of Object.keys(localization.entries)) if (!rows.has(k.toLowerCase())) rows.set(k.toLowerCase(), { key: k, layer: '', text: '' })
  const cell = (key: string, lang: string): string => Object.entries(localization.entries).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1][lang] ?? ''
  const isMissing = (r: { key: string }): string[] => langs.filter((l) => l !== localization.source && cell(r.key, l) === '')
  const missingByLang: Record<string, number> = {}
  let missingRows = 0
  for (const r of rows.values()) {
    const m = isMissing(r)
    if (m.length) missingRows++
    for (const l of m) missingByLang[l] = (missingByLang[l] ?? 0) + 1
  }
  const matches = (r: { key: string; layer: string; text: string }): boolean => matchesQuery(query, r.key, r.layer, r.text, ...langs.map((l) => cell(r.key, l)))
  const shown = [...rows.values()].filter((r) => (!missingOnly || isMissing(r).length > 0) && matches(r))
  // keys read better without the project prefix; the full key stays in the tooltip and in every export
  const shortKey = (k: string): string => (k.startsWith(`$${localization.namespace}_`) ? k.slice(localization.namespace.length + 2) : k)
  const addable = SKYRIM_LANGUAGES.filter((l) => !localization.languages.includes(l))

  const run = async (fn: (() => Promise<{ ok: boolean; summary?: string; error?: string; cancelled?: boolean; localization?: unknown }>) | undefined): Promise<void> => {
    const r = await fn?.()
    if (!r || r.cancelled) return
    useToastStore.getState().push(r.ok ? { tone: 'ok', title: r.summary ?? '' } : { tone: 'error', title: r.error ?? '' })
    if (r.ok && r.localization) void load()
  }

  return (
    <Panel title={strings.loc.title}>
      <div className="toolbar">
        <Btn pressed={missingOnly} onClick={() => setMissingOnly(!missingOnly)} testId="loc-missing-only">
          {strings.loc.missingFilter} <span className={`chip ${missingRows ? 'chip-warn' : ''}`}>{missingRows}</span>
        </Btn>
        <SearchBox className="loc-filter" value={query} onChange={setQuery} label={strings.loc.filter} testId="loc-filter" />
        <span className="push-right row-actions">
          <select value="" onChange={(e) => { if (e.target.value) set(addLanguage(localization, e.target.value)) }} aria-label={strings.loc.addLanguage} data-testid="loc-lang-select">
            <option value="">{strings.loc.addLanguage}</option>
            {addable.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <Popover
            label={strings.loc.importExport}
            align="end"
            trigger={(p, open) => (
              <button type="button" className="btn" {...p} data-testid="loc-import-export">
                {strings.loc.importExport} <ChevronDown size={13} aria-hidden="true" className={open ? 'flip' : undefined} />
              </button>
            )}
          >
            {(close) => (
              <ul className="menu" role="menu" aria-label={strings.loc.importExport}>
                <li><button type="button" role="menuitem" onClick={() => { close(); void run(inkwell?.importLocalizationCsv) }} data-testid="loc-import">{strings.loc.importCsv}…</button></li>
                <li><button type="button" role="menuitem" onClick={() => { close(); void run(inkwell?.exportLocalizationCsv) }} data-testid="loc-export-csv">{strings.loc.exportCsv}…</button></li>
                <li><button type="button" role="menuitem" onClick={() => { close(); void run(inkwell?.exportLocalizationTxt) }} data-testid="loc-export-txt">{strings.loc.exportTxt}…</button></li>
              </ul>
            )}
          </Popover>
        </span>
      </div>
      <table className="loc-table" data-testid="loc-table">
        <colgroup>
          <col className="loc-col-layer" />
          <col className="loc-col-key" />
          <col className="loc-col-source" />
          {langs.slice(1).map((l) => <col key={l} />)}
          <col className="loc-col-act" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{strings.loc.colLayer}</th>
            <th scope="col">{strings.loc.colKey}</th>
            {langs.map((l) => (
              <th key={l} scope="col">
                {l}{l === localization.source ? ` (${strings.loc.source})` : ''}
                {l !== localization.source && (missingByLang[l] ?? 0) > 0 && <span className="chip chip-warn">{strings.loc.missingCount(missingByLang[l] ?? 0)}</span>}
                {l !== localization.source && <Btn icon={undefined} label={strings.loc.removeLanguage(l)} onClick={() => set(removeLanguage(localization, l))} variant="quiet">×</Btn>}
              </th>
            ))}
            <th scope="col" className="loc-cell-act"><span className="sr-only">{strings.loc.colActions}</span></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key}>
              <td>{r.layer || <span className="dim">—</span>}</td>
              <td className="mono dim" title={r.key}>{shortKey(r.key)}</td>
              {langs.map((l) =>
                l === localization.source && !r.graph ? (
                  <td key={l} className="dim" title={strings.loc.cellTitle(r.key, l)}>{r.text || cell(r.key, l)}</td>
                ) : (
                  <td key={l}>
                    <TextCell value={cell(r.key, l)} title={strings.loc.cellTitle(r.key, l)} onCommit={(v) => set(setCell(localization, r.key, l, v))} />
                  </td>
                )
              )}
              <td className="loc-cell-act">
                <Btn icon={Trash2} variant="quiet" className="btn-hover-err" label={strings.loc.deleteRow(shortKey(r.key))} reason={r.layer ? strings.loc.deleteRowInUse : undefined} onClick={() => set(removeKey(localization, r.key))} testId="loc-delete-row" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="empty">{rows.size === 0 ? strings.loc.empty : strings.loc.noMatch}</p>}
    </Panel>
  )
}
