import { useState, type DragEvent } from 'react'
import { ChevronDown, ChevronRight, Copy, Download, Lock, Plus } from 'lucide-react'
import type { Graph } from '@inkwell-ui/spec'
import { FUNCTION_DRAG, GraphRowView, GraphsList } from '../graph/GraphsList'
import { inkwell } from '../hooks/api'
import { reloadPacks, useLibraryPacks, type LibraryPack } from '../hooks/usePacks'
import { AddPackDialog, UpdatePacksDialog, usePackLock } from '../packs/PacksSection'
import { useActiveSwf } from '../hooks/useProject'
import { copyLibraryFunction, forgetLibraryFunction, moveFunctionToPack, openLibraryFunction, renameLibraryFunction, useGraphDocs } from '../state/graphDocs'
import { findGraphStore } from '../state/graphStore'
import { useToastStore } from '../state/toastStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { RowMenu } from '../ui/RowMenu'
import { Panel } from './Panel'

const toast = (t: Parameters<ReturnType<typeof useToastStore.getState>['push']>[0], ms?: number): void => useToastStore.getState().push(t, ms)

/**
 * Behaviour, left tab 2. FUNCTIONS: the project's own functions (not listed in the Navigator); PACKS: every pack the project has (core, installed, the project's own), where a pack holds pure
 * nodes and functions. `New pack…` makes an empty one, dragging a function onto a project pack moves it in, `Export…` writes a project pack as a folder and zip, `Import…` adds one.
 */
export function LibraryPanel() {
  return (
    <Panel title={strings.lib.title}>
      <div className="nav">
        <GraphsList functions />
        <p className="dim">{strings.lib.dragHint}</p>
        <PacksSection />
      </div>
    </Panel>
  )
}

function PacksSection() {
  const swf = useActiveSwf()
  const packs = useLibraryPacks()
  const [replace, setReplace] = useState<{ id: string; path: string } | undefined>()
  const [dialog, setDialog] = useState<'add' | 'update' | undefined>()
  const { project, state, busy, refresh, restore } = usePackLock()
  const unavailable = state.locked.filter((p) => p.state !== 'ok') // in packs.lock but not loaded: the file is missing or does not match its hash
  const installed = (): void => (setDialog(undefined), reloadPacks(), refresh())
  const download = async (): Promise<void> => {
    const err = await restore()
    if (err) toast({ tone: 'error', title: strings.lib.downloadFailed, text: err })
  }
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
        <Btn icon={Plus} haspopup="dialog" label={strings.lib.addTip} reason={project ? state.lockError : strings.assets.packs.noProject} onClick={() => setDialog('add')} testId="packs-add">{strings.assets.packs.add}</Btn>
        <RowMenu
          label={strings.lib.more}
          testId="library-section-more"
          items={[
            { label: strings.lib.import, onClick: () => void importNew() },
            ...(state.locked.length ? [{ label: strings.lib.checkUpdates, onClick: () => setDialog('update') }] : [])
          ]}
        />
      </header>
      {state.lockError && <p className="tone-error" role="alert">{state.lockError}</p>}
      {replace && (
        <p className="tone-warn" role="alert">
          {strings.lib.importReplace(replace.id)} <Btn variant="danger" onClick={() => void doReplace()} testId="library-replace">{strings.lib.replace}</Btn> <Btn onClick={() => setReplace(undefined)}>{strings.lib.cancel}</Btn>
        </p>
      )}
      <ul className="graph-list" role="list">
        {swf && packs.map((p) => <PackRow key={p.id} pack={p} swf={swf} />)}
        {unavailable.map((p) => (
          <li key={p.id} className="graph-row" data-state={p.state}>
            <div className="graph-row-main">
              <span className="layer-main"><Lock size={14} aria-hidden="true" className="type-icon" /><span className="layer-name">{p.id}</span><span className="layer-type">{p.version}</span></span>
              <Btn icon={Download} reason={busy ? strings.assets.packs.working : undefined} label={strings.assets.packs.downloadTip} onClick={() => void download()} testId="packs-restore">{strings.assets.packs.download}</Btn>
            </div>
            <div className="graph-row-events tone-warn">{p.state === 'missing' ? strings.assets.packs.missing : strings.assets.packs.mismatch}</div>
          </li>
        ))}
      </ul>
      {dialog === 'add' && <AddPackDialog onClose={() => setDialog(undefined)} onInstalled={installed} onCreated={installed} />}
      {dialog === 'update' && <UpdatePacksDialog onClose={() => setDialog(undefined)} onInstalled={installed} />}
    </section>
  )
}

function PackRow({ pack, swf }: { pack: LibraryPack; swf: { id: string; name: string } }) {
  const own = pack.origin === 'library' // a local pack: editable. Imported and installed packs are immutable
  const imported = pack.origin === 'imported'
  const [over, setOver] = useState(false)
  const [exporting, setExporting] = useState<string | undefined>()
  const [open, setOpen] = useState(true)
  const has = pack.functions.length > 0
  const activeId = useGraphDocs((s) => s.active[swf.id])
  const note = own ? strings.lib.editedInPlace : strings.lib.editedInstalled
  const accepts = (e: DragEvent): boolean => own && e.dataTransfer.types.includes(FUNCTION_DRAG)
  const drop = async (e: DragEvent): Promise<void> => {
    setOver(false)
    const fnId = e.dataTransfer.getData(FUNCTION_DRAG)
    if (!own || !fnId || fnId.includes('/') || !inkwell) return // a pack's own function is not the project's to move
    e.preventDefault()
    const name = findGraphStore(swf.id, fnId)?.getState().name ?? fnId
    const r = await moveFunctionToPack({ swf, fnId, packId: pack.id }, inkwell)
    reloadPacks()
    toast(r.ok ? { tone: 'ok', title: strings.lib.moved(name, pack.id) } : { tone: 'error', title: strings.lib.moveFailed, text: r.error })
  }
  const remove = async (): Promise<void> => {
    if (!inkwell) return
    const r = await inkwell.removeLibrary(pack.id)
    if (r.ok) reloadPacks()
    else toast({ tone: 'error', title: strings.lib.importFailed, text: r.error })
  }
  const removeFn = async (fn: Graph): Promise<void> => {
    if (!inkwell) return
    const r = await inkwell.removeLibraryFunction(pack.id, fn.id.slice(pack.id.length + 1))
    if (r.ok) (forgetLibraryFunction(swf, fn.id), reloadPacks())
    else toast({ tone: 'error', title: strings.lib.importFailed, text: r.error })
  }
  const copy = async (fn: Graph): Promise<void> => {
    if (!inkwell) return
    const r = await copyLibraryFunction({ swf, fn }, inkwell)
    if (!r.ok) toast({ tone: 'error', title: strings.lib.exportFailed, text: r.error })
  }
  const exportPack = async (): Promise<void> => {
    if (!inkwell || exporting === undefined) return
    const r = await inkwell.exportLibrary(pack.id, exporting.trim() || undefined)
    if ('cancelled' in r) return
    toast(r.ok ? { tone: 'ok', title: strings.lib.exported(pack.id, r.version, r.folder, r.zip) } : { tone: 'error', title: strings.lib.exportFailed, text: r.error }, r.ok ? 15000 : undefined)
    if (r.ok) (setExporting(undefined), reloadPacks())
  }
  return (
    <li
      className={`graph-row pack-row${over ? ' is-drop' : ''}`}
      data-testid={`library-pack-${pack.id}`}
      title={own ? strings.lib.dropTip : undefined}
      onDragOver={(e) => accepts(e) && (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void drop(e)}
    >
      <div className="graph-row-main">
        <button type="button" className="layer-main" aria-expanded={has ? open : undefined} disabled={!has} onClick={() => setOpen(!open)} data-testid={`library-pack-toggle-${pack.id}`}>
          {has && open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          <span className="layer-name">{pack.id}</span>{!own && pack.origin !== 'core' && <Lock size={12} aria-hidden="true" className="type-icon" />}<span className="layer-type">{pack.version} · {strings.lib.origin[pack.origin ?? 'installed']} · {strings.lib.packContents(pack.nodes, pack.functions.length)}</span>
        </button>
        {own && (
          <span className="row-reveal">
            <RowMenu label={strings.lib.more} testId="library-more" items={[{ label: strings.lib.exportOpen, onClick: () => setExporting(pack.version) }, { label: strings.lib.remove(pack.id), danger: true, onClick: () => void remove() }]} />
          </span>
        )}
        {imported && (
          <span className="row-reveal">
            <RowMenu label={strings.lib.more} testId="library-more" items={[{ label: strings.lib.remove(pack.id), danger: true, onClick: () => void remove() }]} />
          </span>
        )}
      </div>
      {exporting !== undefined && (
        <div className="lib-form">
          <label className="gn-field"><span className="gn-field-label">{strings.lib.packVersion}</span><input className="gn-input" value={exporting} onChange={(e) => setExporting(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void exportPack()} /></label>
          <Btn variant="primary" onClick={() => void exportPack()} testId="library-export-run">{strings.lib.exportRun}</Btn>
        </div>
      )}
      {open && <ul className="graph-list" role="list" title={note}>
        {pack.functions.map((fn) => (
          <GraphRowView
            key={fn.id}
            id={fn.id}
            name={fn.name}
            scope="function"
            sig={fn.signature}
            active={activeId === fn.id}
            {...(own || pack.origin === 'core' ? {} : { locked: strings.lib.locked })}
            onOpen={() => openLibraryFunction(swf, fn)}
            onRename={(n) => renameLibraryFunction(swf, fn, n)}
            onDelete={() => void removeFn(fn)}
            extra={<Btn icon={Copy} variant="quiet" label={strings.lib.copyTip(fn.name)} onClick={() => void copy(fn)} testId="library-copy" />}
          />
        ))}
      </ul>}
    </li>
  )
}
