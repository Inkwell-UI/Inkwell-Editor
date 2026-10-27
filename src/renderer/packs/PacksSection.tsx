import { useCallback, useEffect, useState } from 'react'
import { Download, Lock, Plus, RefreshCw } from 'lucide-react'
import type { PackCandidate, PackIndexEntry, PacksState } from '../../shared/packs'
import { inkwell } from '../hooks/api'
import { reloadPacks, usePackList } from '../hooks/usePacks'
import { useProject } from '../hooks/useProject'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Dialog } from '../ui/Dialog'

const S = strings.assets.packs

/**
 * Assets > Node packs (UX 4.2; 0.5 Phase 2): the bundled core pack and every pack of packs.lock with its cache state; Add (Packs Index search or a
 * GitHub URL), Download (restore what the cache lacks, hash checked), Check Updates (changelog first). Main does all network and file work.
 */
export function PacksSection({ title, empty }: { title: string; empty: string }) {
  const project = useProject()
  const loaded = usePackList()
  const [state, setState] = useState<PacksState>({ locked: [] })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>()
  const [dialog, setDialog] = useState<'add' | 'update' | undefined>()
  const refresh = useCallback(() => void inkwell?.getPacksState().then(setState), [])
  useEffect(refresh, [refresh, project?.dir])
  const changed = (text: string): void => {
    setNote({ tone: 'ok', text })
    setDialog(undefined)
    reloadPacks()
    refresh()
  }
  const restore = async (): Promise<void> => {
    if (!inkwell) return
    setBusy(true)
    const r = await inkwell.restorePacks()
    setBusy(false)
    if (!r.ok) return setNote({ tone: 'error', text: r.error })
    reloadPacks()
    refresh()
    setNote(r.errors.length ? { tone: 'error', text: r.errors.join('\n') } : { tone: 'ok', text: S.restored(r.restored) })
  }
  const noProject = project ? undefined : S.noProject
  const nodesOf = (id: string): number | undefined => loaded.find((p) => p.id === id)?.nodes
  const core = loaded.find((p) => p.id === 'core')
  return (
    <section aria-labelledby="assets-packs" data-testid="packs-section">
      <header className="section-title">
        <h3 id="assets-packs">{title}</h3>
        <Btn icon={Plus} haspopup="dialog" reason={noProject ?? state.lockError} onClick={() => setDialog('add')} testId="packs-add">{S.add}</Btn>
        <Btn icon={RefreshCw} haspopup="dialog" reason={noProject ?? state.lockError ?? (state.locked.length ? undefined : empty)} onClick={() => setDialog('update')} testId="packs-updates">{strings.assets.sections[1]!.action}</Btn>
      </header>
      {state.lockError && <p className="tone-error" role="alert">{state.lockError}</p>}
      <ul className="plain" data-testid="pack-list">
        {core && <li><span className="mono">core</span> {core.version} <span className="dim">{S.bundled}, {strings.assets.packNodes(core.nodes)}</span></li>}
        {state.locked.map((p) => (
          <li key={p.id} data-state={p.state}>
            <Lock size={12} aria-hidden="true" /> <span className="mono">{p.id}</span> {p.version}{' '}
            {p.state === 'ok' ? <span className="dim">{strings.assets.packNodes(nodesOf(p.id) ?? 0)}</span> : <span className="tone-warn">{p.state === 'missing' ? S.missing : S.mismatch}</span>}
          </li>
        ))}
      </ul>
      {!state.locked.length && !state.lockError && <p className="empty">{empty}</p>}
      {state.locked.some((p) => p.state !== 'ok') && (
        <div className="row-actions">
          <Btn icon={Download} label={S.downloadTip} reason={busy ? S.working : undefined} onClick={() => void restore()} testId="packs-restore">{S.download}</Btn>
        </div>
      )}
      {note && <p className={`tone-${note.tone} pack-note`} role={note.tone === 'error' ? 'alert' : 'status'}>{note.text}</p>}
      {dialog === 'add' && <AddPackDialog onClose={() => setDialog(undefined)} onInstalled={(c) => changed(S.installed(c.id, c.version))} />}
      {dialog === 'update' && <UpdatePacksDialog onClose={() => setDialog(undefined)} onInstalled={(c) => changed(S.installed(c.id, c.version))} />}
    </section>
  )
}

/** Repo, version, content hash, node count and changelog of one download, then Install. Shared by the add and update dialogs. */
function Candidate({ c, action, onInstalled }: { c: PackCandidate; action: string; onInstalled(c: PackCandidate): void }) {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const install = async (): Promise<void> => {
    setBusy(true)
    const r = await inkwell!.installPack(c.token)
    setBusy(false)
    if (r.ok) onInstalled(c)
    else setError(r.error)
  }
  return (
    <div className="pack-candidate" data-testid="pack-candidate">
      <h3 className="mono">{c.id} {c.current ? S.from(c.current, c.version) : c.version}</h3>
      {c.deprecated && <p className="tone-warn">{S.deprecated(c.deprecated)}</p>}
      <p className="dim">{S.changelog}</p>
      {c.changelog ? <pre className="deploy-path pack-changelog" data-testid="pack-changelog">{c.changelog}</pre> : <p className="empty">{S.noChangelog}</p>}
      <dl>
        <dt>{S.repo}</dt><dd className="mono">{c.repo}</dd>
        <dt>{S.version}</dt><dd className="mono">{c.version}</dd>
        <dt>{S.hash}</dt><dd className="mono deploy-path" data-testid="pack-hash">{c.sha256}</dd>
        <dt>{S.nodes}</dt><dd>{c.nodes}</dd>
      </dl>
      {error && <p className="tone-error" role="alert">{error}</p>}
      <div className="row-actions">
        <Btn variant="primary" reason={busy ? S.working : undefined} onClick={() => void install()} testId="pack-install">{action}</Btn>
      </div>
    </div>
  )
}

function AddPackDialog({ onClose, onInstalled }: { onClose(): void; onInstalled(c: PackCandidate): void }) {
  const [index, setIndex] = useState<{ list?: PackIndexEntry[]; error?: string }>({})
  const [query, setQuery] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [candidate, setCandidate] = useState<PackCandidate>()
  useEffect(() => void inkwell?.getPacksIndex().then((r) => setIndex(r.ok ? { list: r.index } : { error: r.error })), [])
  const fetchPack = async (input: string): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const r = await inkwell!.resolvePack(input)
    setBusy(false)
    if (r.ok) setCandidate(r.candidate)
    else setError(r.error)
  }
  const q = query.trim().toLowerCase()
  const hits = (index.list ?? []).filter((e) => !q || e.id.includes(q) || (e.description ?? '').toLowerCase().includes(q))
  return (
    <Dialog title={candidate ? S.confirmTitle : S.addTitle} onClose={onClose} wide>
      {candidate ? (
        <>
          <p className="banner banner-info"><span>{S.trust}</span></p>
          <Candidate c={candidate} action={S.install} onInstalled={onInstalled} />
          <div className="row-actions"><Btn onClick={() => setCandidate(undefined)}>{S.cancel}</Btn></div>
        </>
      ) : (
        <div data-testid="packs-add-dialog">
          <label>
            {S.search}
            <input className="input" value={query} placeholder={S.searchPlaceholder} onChange={(e) => setQuery(e.target.value)} data-testid="packs-search" />
          </label>
          {index.error ? <p className="tone-error" role="alert">{index.error}</p> : !index.list ? <p className="dim">{S.indexLoading}</p> : hits.length === 0 ? <p className="empty">{S.indexEmpty}</p> : (
            <ul className="plain" data-testid="packs-index">
              {hits.map((e) => (
                <li key={e.id} className="row-actions">
                  <span className="mono">{e.id}</span> {e.latest} <span className="dim">{e.description ?? e.repo}</span>
                  {e.deprecated && <span className="tone-warn">{S.deprecated(e.deprecated)}</span>}
                  <Btn reason={busy ? S.working : undefined} onClick={() => void fetchPack(`https://github.com/${e.repo}/releases/tag/v${e.latest}`)}>{S.pick}</Btn>
                </li>
              ))}
            </ul>
          )}
          <label>
            {S.byUrl}
            <span className="row-actions">
              <input className="input" value={url} placeholder={S.urlPlaceholder} onChange={(e) => setUrl(e.target.value)} data-testid="packs-url" />
              <Btn reason={busy ? S.working : url.trim() ? undefined : S.urlPlaceholder} onClick={() => void fetchPack(url)} testId="packs-fetch">{S.fetch}</Btn>
            </span>
          </label>
          {busy && <p className="dim">{S.working}</p>}
          {error && <p className="tone-error" role="alert">{error}</p>}
        </div>
      )}
    </Dialog>
  )
}

function UpdatePacksDialog({ onClose, onInstalled }: { onClose(): void; onInstalled(c: PackCandidate): void }) {
  const [r, setR] = useState<{ updates: PackCandidate[]; errors: string[] } | { error: string }>()
  useEffect(() => void inkwell?.checkPackUpdates().then((x) => setR(x.ok ? x : { error: x.error })), [])
  return (
    <Dialog title={S.updateTitle} onClose={onClose} wide>
      <div data-testid="packs-update-dialog">
        {!r ? <p className="dim">{S.checking}</p> : 'error' in r ? <p className="tone-error" role="alert">{r.error}</p> : (
          <>
            {r.errors.map((e) => <p key={e} className="tone-error" role="alert">{e}</p>)}
            {r.updates.length === 0 && r.errors.length === 0 && <p className="tone-ok">{S.upToDate}</p>}
            {r.updates.map((c) => <Candidate key={c.token} c={c} action={S.update} onInstalled={onInstalled} />)}
          </>
        )}
      </div>
    </Dialog>
  )
}
