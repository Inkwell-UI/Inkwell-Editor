import { useEffect, useMemo, useState } from 'react'
import { SKYRIM_LANGUAGES, type Swf } from '@inkwell-ui/spec'
import { inkwell } from '../hooks/api'
import { useProject } from '../hooks/useProject'
import { keyedTexts, type LocSwf } from '../../main/lint/localization'
import { addLanguage, removeLanguage, setCell } from '../../shared/localizationOps'
import { RUNTIME_FEATURE_SINCE } from '../../shared/runtimeFeatures'
import { getOverlayDoc } from '../state/overlayStore'
import { loadSwfGraphs, useGraphDocs } from '../state/graphDocs'
import { findGraphStore, toGraph } from '../state/graphStore'
import { useLocalizationStore } from '../state/localizationStore'
import { useToastStore } from '../state/toastStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/** Zone 6A, tab 2 (UX 4.6): the translation table of the project's keyed text layers (SPEC-CHANGES V2 to V4, V11.1). Cells save at once into localization.json. */
export function LocalizationPanel() {
  const project = useProject()
  const { loaded, localization, error, load, set, create } = useLocalizationStore()
  const [missingOnly, setMissingOnly] = useState(false)
  const [newLang, setNewLang] = useState('')
  const dir = project?.dir

  useEffect(() => void (dir && load()), [dir, load])
  // keyed Set Text nodes of graphs are rows too (V13.2), so every SWF's graphs are loaded (once; the Graph panel shares them)
  useEffect(() => void (project?.swfs ?? []).forEach((s) => inkwell && void loadSwfGraphs(s, inkwell)), [project])
  const graphIds = useGraphDocs((s) => s.ids)

  const swfs: LocSwf[] = useMemo(
    () => (project?.swfs ?? []).map((s) => ({
      name: s.name, kind: s.ir.target.kind, orphaned: s.orphaned, ir: s.ir as Swf, overlay: (getOverlayDoc(s.id)?.nodes ?? s.overlay.nodes ?? {}) as Record<string, Record<string, unknown>>,
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
  const shown = [...rows.values()].filter((r) => !missingOnly || langs.some((l) => l !== localization.source && cell(r.key, l) === ''))
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
        <span className="dim mono">{strings.loc.prefix(localization.namespace)}</span>
        <label className="row-actions"><input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} data-testid="loc-missing-only" /> {strings.loc.missingOnly}</label>
        <span className="row-actions">
          <select value={newLang} onChange={(e) => setNewLang(e.target.value)} aria-label={strings.loc.addLanguage} data-testid="loc-lang-select">
            <option value="">{strings.loc.addLanguage}…</option>
            {addable.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <Btn reason={newLang ? undefined : strings.loc.addLanguage} onClick={() => { set(addLanguage(localization, newLang)); setNewLang('') }} testId="loc-add-lang">{strings.loc.addLanguage}</Btn>
        </span>
        <span className="push-right row-actions">
          <Btn onClick={() => void run(inkwell?.importLocalizationCsv)} testId="loc-import">{strings.loc.importCsv}</Btn>
          <Btn onClick={() => void run(inkwell?.exportLocalizationCsv)} testId="loc-export-csv">{strings.loc.exportCsv}</Btn>
          <Btn onClick={() => void run(inkwell?.exportLocalizationTxt)} testId="loc-export-txt">{strings.loc.exportTxt}</Btn>
        </span>
      </div>
      <p className="dim">{strings.loc.runtimeNote(RUNTIME_FEATURE_SINCE.translation)}</p>
      <table data-testid="loc-table">
        <thead>
          <tr>
            <th scope="col">{strings.loc.colLayer}</th>
            <th scope="col">{strings.loc.colKey}</th>
            {langs.map((l) => (
              <th key={l} scope="col">
                {l}{l === localization.source ? ` (${strings.loc.source})` : ''}
                {l !== localization.source && <Btn icon={undefined} label={strings.loc.removeLanguage(l)} onClick={() => set(removeLanguage(localization, l))} variant="quiet">×</Btn>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key}>
              <td>{r.layer || <span className="dim">—</span>}</td>
              <td className="mono">{r.key}</td>
              {langs.map((l) =>
                l === localization.source && !r.graph ? (
                  <td key={l} title={strings.loc.cellTitle(r.key, l)}>{r.text || cell(r.key, l)}</td>
                ) : (
                  <td key={l}>
                    <TextCell value={cell(r.key, l)} title={strings.loc.cellTitle(r.key, l)} onCommit={(v) => set(setCell(localization, r.key, l, v))} />
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="empty">{strings.loc.empty}</p>}
    </Panel>
  )
}

/** One translation cell: edits stay local until Enter or blur; empty shows the missing marker. */
function TextCell({ value, title, onCommit }: { value: string; title: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState<string | undefined>()
  const commit = (): void => {
    if (draft !== undefined && draft !== value) onCommit(draft)
    setDraft(undefined)
  }
  return (
    <input
      value={draft ?? value}
      placeholder={strings.loc.missing}
      title={title}
      aria-label={title}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(undefined)
      }}
    />
  )
}
