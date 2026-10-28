import { useState } from 'react'
import { Copy, Pencil, Trash2 } from 'lucide-react'
import type { Graph } from '@inkwell-ui/spec'
import { GraphsList } from '../graph/GraphsList'
import { inkwell } from '../hooks/api'
import { reloadPacks, useLibraryPacks, type LibraryPack } from '../hooks/usePacks'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useActiveSwf } from '../hooks/useProject'
import { copyLibraryFunction, openLibraryFunction } from '../state/graphDocs'
import { findGraphStore } from '../state/graphStore'
import { useToastStore } from '../state/toastStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

const toast = (t: Parameters<ReturnType<typeof useToastStore.getState>['push']>[0], ms?: number): void => useToastStore.getState().push(t, ms)
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-library'

/** Behaviour, left tab 2: the project's custom functions (not listed in the Navigator), a form to export some of them as a library, and the libraries the project has (import, open, copy, remove). */
export function LibraryPanel() {
  return (
    <Panel title={strings.lib.title}>
      <div className="nav">
        <GraphsList functions />
        <ExportSection />
        <LibrariesSection />
      </div>
    </Panel>
  )
}

/** `Export…` opens an inline form: which functions, the pack id, version, description and credits. The main process asks for the folder, writes the pack folder and zip and refuses a selection that calls a function you did not tick. */
function ExportSection() {
  const swf = useActiveSwf()
  const { ids } = useSwfGraphs()
  const fns = swf ? ids.flatMap((id) => { const s = findGraphStore(swf.id, id); return s && s.getState().meta.scope === 'function' ? [{ id, name: s.getState().name }] : [] }) : []
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [form, setForm] = useState({ id: '', version: '1.0.0', description: '', credits: '' })
  const set = (k: keyof typeof form, v: string): void => setForm((f) => ({ ...f, [k]: v }))
  const run = async (): Promise<void> => {
    if (!swf || !inkwell) return
    if (picked.size === 0) return toast({ tone: 'error', title: strings.lib.exportFailed, text: strings.lib.exportNeedFns })
    const r = await inkwell.exportLibrary(swf.name, [...picked], { id: form.id || slug(swf.name), version: form.version, ...(form.description ? { description: form.description } : {}), ...(form.credits ? { credits: form.credits } : {}) })
    if ('cancelled' in r) return
    toast(r.ok ? { tone: 'ok', title: strings.lib.exportTitle, text: strings.lib.exported(r.functions.length, r.folder, r.zip) } : { tone: 'error', title: strings.lib.exportFailed, text: r.error }, r.ok ? 15000 : undefined)
    if (r.ok) setOpen(false)
  }
  return (
    <section aria-labelledby="lib-export" data-testid="library-export">
      <header className="section-title">
        <h3 id="lib-export">{strings.lib.exportTitle}</h3>
        <Btn label={strings.lib.exportTip} onClick={() => setOpen(!open)} pressed={open} reason={fns.length === 0 ? strings.lib.exportNone : undefined} testId="library-export-open">{strings.lib.exportOpen}</Btn>
      </header>
      {open && (
        <div className="lib-form">
          <div className="gn-field-label">{strings.lib.exportPick}</div>
          <ul className="plain">
            {fns.map((f) => (
              <li key={f.id}><label className="lib-check"><input type="checkbox" checked={picked.has(f.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n })} />{f.name}</label></li>
            ))}
          </ul>
          <label className="gn-field"><span className="gn-field-label">{strings.lib.exportId}</span><input className="gn-input" value={form.id} placeholder={swf ? slug(swf.name) : ''} onChange={(e) => set('id', e.target.value)} /></label>
          <label className="gn-field"><span className="gn-field-label">{strings.lib.exportVersion}</span><input className="gn-input" value={form.version} onChange={(e) => set('version', e.target.value)} /></label>
          <label className="gn-field"><span className="gn-field-label">{strings.lib.exportDescription}</span><input className="gn-input" value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
          <label className="gn-field"><span className="gn-field-label">{strings.lib.exportCredits}</span><input className="gn-input" value={form.credits} onChange={(e) => set('credits', e.target.value)} /></label>
          <Btn variant="primary" onClick={() => void run()} testId="library-export-run">{strings.lib.exportRun}</Btn>
        </div>
      )}
    </section>
  )
}

/** The libraries of the project: `Import…` (a pack folder or zip), each pack with its functions (open to edit in place, copy to the project), remove for the project's own libraries. */
function LibrariesSection() {
  const swf = useActiveSwf()
  const packs = useLibraryPacks()
  const [replace, setReplace] = useState<{ id: string; path: string } | undefined>()
  const done = (r: Awaited<ReturnType<NonNullable<typeof inkwell>['importLibrary']>>): void => {
    if ('cancelled' in r) return
    if (!r.ok && 'exists' in r) return setReplace({ id: r.id, path: r.path })
    setReplace(undefined)
    if (r.ok) reloadPacks()
    toast(r.ok ? { tone: 'ok', title: strings.lib.imported(r.id, r.functions.length) } : { tone: 'error', title: strings.lib.importFailed, text: r.error })
  }
  const importNew = async (): Promise<void> => inkwell && done(await inkwell.importLibrary())
  const doReplace = async (): Promise<void> => inkwell && replace && done(await inkwell.importLibrary(replace))
  return (
    <section aria-labelledby="lib-libs" data-testid="library-libraries">
      <header className="section-title">
        <h3 id="lib-libs">{strings.lib.libraries}</h3>
        <Btn label={strings.lib.importTip} onClick={() => void importNew()} testId="library-import">{strings.lib.import}</Btn>
      </header>
      {replace && (
        <p className="tone-warn" role="alert">
          {strings.lib.importReplace(replace.id)} <Btn variant="danger" onClick={() => void doReplace()} testId="library-replace">{strings.lib.replace}</Btn> <Btn onClick={() => setReplace(undefined)}>{strings.lib.cancel}</Btn>
        </p>
      )}
      {packs.length === 0 && <p className="empty">{strings.lib.librariesEmpty}</p>}
      <ul className="graph-list" role="list">
        {swf && packs.map((p) => <PackRow key={p.id} pack={p} swf={swf} />)}
      </ul>
    </section>
  )
}

function PackRow({ pack, swf }: { pack: LibraryPack; swf: { id: string; name: string } }) {
  const note = pack.origin === 'library' ? strings.lib.editedInPlace : strings.lib.editedInstalled
  const remove = async (): Promise<void> => {
    if (!inkwell) return
    const r = await inkwell.removeLibrary(pack.id)
    if (r.ok) reloadPacks()
    else toast({ tone: 'error', title: strings.lib.importFailed, text: r.error })
  }
  const copy = async (fn: Graph): Promise<void> => {
    if (!inkwell) return
    const r = await copyLibraryFunction({ swf, fn }, inkwell)
    if (!r.ok) toast({ tone: 'error', title: strings.lib.exportFailed, text: r.error })
  }
  return (
    <li className="graph-row" data-testid={`library-pack-${pack.id}`}>
      <div className="graph-row-main">
        <span className="layer-main"><span className="layer-name">{pack.id}</span><span className="layer-type">{pack.version} · {strings.lib.origin[pack.origin ?? 'installed']}</span></span>
        {pack.origin === 'library' && <Btn icon={Trash2} label={strings.lib.remove(pack.id)} onClick={() => void remove()} testId="library-remove" />}
      </div>
      <ul className="plain lib-fns" title={note}>
        {pack.functions.map((fn) => (
          <li key={fn.id} className="graph-row-main">
            <Btn icon={Pencil} label={strings.lib.open(fn.name)} onClick={() => openLibraryFunction(swf, fn)} testId="library-open">{fn.name}</Btn>
            <Btn icon={Copy} label={strings.lib.copyTip(fn.name)} onClick={() => void copy(fn)} testId="library-copy" />
          </li>
        ))}
      </ul>
    </li>
  )
}
