import { useCallback, useEffect, useState } from 'react'
import { Download, Info, Lock, Plus, RefreshCw, Search } from 'lucide-react'
import type { PackCandidate, PackIndexEntry, PacksState } from '../../shared/packs'
import { inkwell } from '../hooks/api'
import { reloadPacks, useLibraryPacks, usePackList } from '../hooks/usePacks'
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
  const local = useLibraryPacks().filter((p) => p.origin === 'library' || p.origin === 'imported')
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
        {local.map((p) => (
          <li key={p.id} data-state="local"><span className="mono">{p.id}</span> {p.version} <span className="dim">{strings.lib.origin[p.origin ?? 'library']}, {strings.lib.packContents(p.nodes, p.functions.length)}</span></li>
        ))}
      </ul>
      {!state.locked.length && !local.length && !state.lockError && <p className="empty">{empty}</p>}
      {state.locked.some((p) => p.state !== 'ok') && (
        <div className="row-actions">
          <Btn icon={Download} label={S.downloadTip} reason={busy ? S.working : undefined} onClick={() => void restore()} testId="packs-restore">{S.download}</Btn>
        </div>
      )}
      {note && <p className={`tone-${note.tone} pack-note`} role={note.tone === 'error' ? 'alert' : 'status'}>{note.text}</p>}
      {dialog === 'add' && <AddPackDialog onClose={() => setDialog(undefined)} onInstalled={(c) => changed(S.installed(c.id, c.version))} onCreated={() => (setDialog(undefined), reloadPacks())} />}
      {dialog === 'update' && <UpdatePacksDialog onClose={() => setDialog(undefined)} onInstalled={(c) => changed(S.installed(c.id, c.version))} />}
    </section>
  )
}

/** What a click on Add or Fetch resolves: a GitHub address (owner/name or a github.com link), not a word to search the index for. */
const looksLikeRepo = (s: string): boolean => /^https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(s) || /^[\w.-]+\/[\w.-]+$/.test(s)

/** One download before it is installed: the pack and version first, then the repository, node count and hash to compare, the changelog, and Install. Shared by the add and update dialogs. */
function Candidate({ c, action, trust, onCancel, onInstalled }: { c: PackCandidate; action: string; trust?: boolean; onCancel?(): void; onInstalled(c: PackCandidate): void }) {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const install = async (): Promise<void> => {
    setBusy(true)
    const r = await inkwell!.installPack(c.token)
    setBusy(false)
    if (r.ok) onInstalled(c)
    else setError(r.error)
  }
  const copy = (): void => {
    const done = (): void => (setCopied(true), void setTimeout(() => setCopied(false), 1400))
    void navigator.clipboard?.writeText(c.sha256).then(done, () => undefined)
  }
  return (
    <div className="pack-candidate" data-testid="pack-candidate">
      <div className="pack-head">
        <span className="pack-id mono">{c.id}</span>
        <span className="pack-ver mono">{c.current ? S.from(c.current, c.version) : S.versionOf(c.version)}</span>
        {c.deprecated && <span className="pack-tag">{S.deprecatedTag}</span>}
      </div>
      {c.deprecated && <p className="dim">{c.deprecated}</p>}
      <dl className="pack-facts">
        <dt>{S.repo}</dt><dd className="mono">{c.repo}</dd>
        <dt>{S.nodes}</dt><dd>{c.nodes}</dd>
        <dt>{S.hash}</dt>
        <dd>
          <span className="pack-hash">
            <code data-testid="pack-hash">{c.sha256}</code>
            <Btn onClick={copy}>{copied ? S.copied : S.copy}</Btn>
          </span>
          <span className="dim">{S.hashHint}</span>
        </dd>
      </dl>
      <div>
        <span className="field-label">{S.changelog}</span>
        {c.changelog ? <pre className="pack-changelog" data-testid="pack-changelog">{c.changelog}</pre> : <p className="empty">{S.noChangelog}</p>}
      </div>
      {trust && (
        <div className="pack-trust" role="note">
          <Info size={16} aria-hidden="true" />
          <div>
            {S.trustShort}
            <details><summary>{S.why}</summary><p>{S.trust}</p></details>
          </div>
        </div>
      )}
      {error && <p className="tone-error" role="alert">{error}</p>}
      <div className="row-actions pack-actions">
        {onCancel && <Btn onClick={onCancel}>{S.cancel}</Btn>}
        <Btn variant="primary" reason={busy ? S.working : undefined} onClick={() => void install()} testId="pack-install">{action}</Btn>
      </div>
    </div>
  )
}

/** One field takes a pack name (filters the Packs Index) or a GitHub address (a row of its own that fetches the latest release). */
function AddPackDialog({ onClose, onInstalled, onCreated }: { onClose(): void; onInstalled(c: PackCandidate): void; onCreated(id: string): void }) {
  const [tab, setTab] = useState<'github' | 'new'>('github')
  const [index, setIndex] = useState<{ list?: PackIndexEntry[]; error?: string }>({})
  const [query, setQuery] = useState('')
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
  const input = query.trim()
  const q = input.toLowerCase()
  const repo = looksLikeRepo(input)
  const hits = repo ? [] : (index.list ?? []).filter((e) => !q || e.id.includes(q) || (e.description ?? '').toLowerCase().includes(q))
  const wait = busy ? S.working : undefined
  return (
    <Dialog title={candidate ? S.confirmTitle : S.addTitle} onClose={onClose}>
      {candidate ? (
        <Candidate c={candidate} action={S.install} trust onCancel={() => setCandidate(undefined)} onInstalled={onInstalled} />
      ) : (
        <div className="pack-add" data-testid="packs-add-dialog">
          <div className="pack-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'github'} onClick={() => setTab('github')} data-testid="packs-tab-github">{S.tabGithub}</button>
            <button type="button" role="tab" aria-selected={tab === 'new'} onClick={() => setTab('new')} data-testid="packs-tab-new">{S.tabNew}</button>
          </div>
          {tab === 'new' ? <NewPackForm onCreated={onCreated} onCancel={onClose} /> : <>
          <div>
            <label className="field-label" htmlFor="packs-search">{S.search}</label>
            <div className="search-field">
              <Search size={15} aria-hidden="true" />
              <input id="packs-search" className="input" value={query} placeholder={S.searchPlaceholder} autoComplete="off" spellCheck={false} onChange={(e) => setQuery(e.target.value)} data-testid="packs-search" />
            </div>
          </div>
          {repo && (
            <ul className="pack-list">
              <li className="pack-item is-repo">
                <span className="pack-item-title"><b className="mono">{input.replace(/^https?:\/\/(www\.)?github\.com\//i, '')}</b><span className="mono">{S.github}</span></span>
                <span className="pack-item-desc">{S.fetchHint}</span>
                <Btn variant="primary" reason={wait} onClick={() => void fetchPack(input)} testId="packs-fetch">{S.fetch}</Btn>
              </li>
            </ul>
          )}
          {!repo && (index.error ? <p className="tone-error" role="alert">{index.error}</p> : !index.list ? <p className="dim">{S.indexLoading}</p> : hits.length === 0 ? (
            <div className="pack-empty"><b>{input ? S.noMatch(input) : S.indexEmpty}</b>{S.noMatchHint}</div>
          ) : (
            <ul className="pack-list" data-testid="packs-index">
              {hits.map((e) => (
                <li key={e.id} className="pack-item">
                  <span className="pack-item-title"><b className="mono">{e.id}</b><span className="mono">{e.latest}</span>{e.deprecated && <span className="pack-tag">{S.deprecatedTag}</span>}</span>
                  <span className="pack-item-desc">{e.deprecated ?? e.description ?? e.repo}</span>
                  <Btn reason={wait} onClick={() => void fetchPack(`https://github.com/${e.repo}/releases/tag/v${e.latest}`)}>{S.pick}</Btn>
                </li>
              ))}
            </ul>
          ))}
          {busy && <p className="dim">{S.working}</p>}
          {error && <p className="tone-error" role="alert">{error}</p>}
          </>}
        </div>
      )}
    </Dialog>
  )
}

/** "New local pack" tab: an empty pack in `<project>/libraries/<id>/`; functions are dragged onto it in the Library tab. Main validates the id and version. */
function NewPackForm({ onCreated, onCancel }: { onCreated(id: string): void; onCancel(): void }) {
  const [id, setId] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const create = async (): Promise<void> => {
    if (!inkwell) return
    setBusy(true)
    setError(undefined)
    try {
      const r = await inkwell.createLibrary({ id: id.trim(), version: version.trim(), ...(description.trim() ? { description: description.trim() } : {}) })
      if (r.ok) onCreated(r.id)
      else setError(r.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)) // e.g. the main process predates this feature: restart the editor
    } finally {
      setBusy(false)
    }
  }
  const valid = /^[a-z0-9][a-z0-9._-]*$/.test(id.trim()) && /^\d+\.\d+\.\d+$/.test(version.trim())
  return (
    <form className="pack-add" onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && valid && !busy && void create()} data-testid="packs-new-form">
      <div className="pack-new-row">
        <div><label className="field-label" htmlFor="packs-new-id">{S.newId}</label><input id="packs-new-id" className="input" value={id} placeholder="my-pack" autoFocus autoComplete="off" spellCheck={false} onChange={(e) => setId(e.target.value)} data-testid="packs-new-id" /></div>
        <div><label className="field-label" htmlFor="packs-new-version">{S.newVersion}</label><input id="packs-new-version" className="input" value={version} autoComplete="off" onChange={(e) => setVersion(e.target.value)} /></div>
      </div>
      <div><label className="field-label" htmlFor="packs-new-desc">{S.newDescription}</label><input id="packs-new-desc" className="input" value={description} placeholder={S.newDescriptionPlaceholder} onChange={(e) => setDescription(e.target.value)} /></div>
      <p className="dim">{S.newHint}</p>
      {error && <p className="tone-error" role="alert">{error}</p>}
      <div className="pack-new-foot"><Btn onClick={onCancel}>{strings.lib.cancel}</Btn><Btn variant="primary" onClick={() => void create()} reason={valid ? (busy ? S.working : undefined) : S.newInvalid} testId="packs-new-create">{S.newCreate}</Btn></div>
    </form>
  )
}

function UpdatePacksDialog({ onClose, onInstalled }: { onClose(): void; onInstalled(c: PackCandidate): void }) {
  const [r, setR] = useState<{ updates: PackCandidate[]; errors: string[] } | { error: string }>()
  useEffect(() => void inkwell?.checkPackUpdates().then((x) => setR(x.ok ? x : { error: x.error })), [])
  return (
    <Dialog title={S.updateTitle} onClose={onClose}>
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
