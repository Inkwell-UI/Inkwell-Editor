import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleArrowUp, Download, Info, Plus, Search } from 'lucide-react'
import type { Graph } from '@inkwell-ui/spec'
import type { LockedPack, PackCandidate, PackIndexEntry, PacksState } from '../../shared/packs'
import { compareSemver } from '../../shared/semverRange'
import { strings } from '../../shared/strings'
import { inkwell } from '../hooks/api'
import { reloadPacks, useLibraryPacks, usePacks } from '../hooks/usePacks'
import { useProject } from '../hooks/useProject'
import { inspectorText } from '../model/graphModel'
import { useToastStore } from '../state/toastStore'
import { Btn } from '../ui/Btn'
import { Dialog } from '../ui/Dialog'
import { RowMenu } from '../ui/RowMenu'

const S = strings.assets.packs
const PM = strings.packMgr

const toast = (t: Parameters<ReturnType<typeof useToastStore.getState>['push']>[0], ms?: number): void => useToastStore.getState().push(t, ms)

/**
 * The state behind the pack list (docs/graphs.md, Downloaded packs): packs.lock with the cache state of each pack (missing or not matching the hash), and the download that
 * restores what the cache lacks. Main does all network and file work.
 */
export function usePackLock() {
  const project = useProject()
  const [state, setState] = useState<PacksState>({ locked: [] })
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(() => void inkwell?.getPacksState().then(setState), [])
  useEffect(refresh, [refresh, project?.dir])
  /** Downloads the locked packs the cache lacks (hash checked). Returns the problems, if any. */
  const restore = async (): Promise<string | undefined> => {
    if (!inkwell) return undefined
    setBusy(true)
    const r = await inkwell.restorePacks()
    setBusy(false)
    if (!r.ok) return r.error
    reloadPacks()
    refresh()
    return r.errors.length ? r.errors.join(' ') : undefined
  }
  return { project, state, busy, refresh, restore }
}

/** What the search field resolves with Enter or a click: a GitHub address (owner/name or a github.com link), not a word to search the index for. */
const looksLikeRepo = (s: string): boolean => /^https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(s) || /^[\w.-]+\/[\w.-]+$/.test(s)

type Where = 'core' | 'installed' | 'local' | 'imported' | 'index'
const WHERE_ORDER: Where[] = ['core', 'installed', 'local', 'imported', 'index']
interface Entry {
  id: string
  version: string
  where: Where
  nodes: number
  functions: Graph[]
  desc?: string
  repo?: string
  /** A newer release in the Packs Index. */
  latest?: string
  problem?: LockedPack['state']
  deprecated?: string
}
type Source = 'project' | 'index' | 'updates'

const repoOfSource = (source: string): string | undefined => /github\.com\/([\w.-]+\/[\w.-]+?)\/releases/i.exec(source)?.[1]

/** Every pack the project has (loaded, or locked but not downloaded) merged with what the Packs Index offers. */
function buildEntries(loaded: readonly { id: string; version: string; origin?: string | undefined; nodes: number; functions: Graph[] }[], locked: readonly LockedPack[], index: readonly PackIndexEntry[]): Entry[] {
  const idx = new Map(index.map((e) => [e.id, e]))
  const info = (id: string, version: string): Pick<Entry, 'desc' | 'repo' | 'latest' | 'deprecated'> => {
    const e = idx.get(id)
    return { ...(e?.description ? { desc: e.description } : {}), ...(e ? { repo: e.repo } : {}), ...(e && compareSemver(e.latest, version) > 0 ? { latest: e.latest } : {}), ...(e?.deprecated ? { deprecated: e.deprecated } : {}) }
  }
  const out: Entry[] = loaded.map((p) => {
    const where: Where = p.origin === 'core' ? 'core' : p.origin === 'library' ? 'local' : p.origin === 'imported' ? 'imported' : 'installed'
    return { id: p.id, version: p.version, where, nodes: p.nodes + p.functions.length, functions: p.functions, ...(where === 'installed' ? info(p.id, p.version) : {}) }
  })
  for (const l of locked) {
    const e = out.find((x) => x.id === l.id)
    const repo = repoOfSource(l.source)
    if (e) e.repo ??= repo
    else out.push({ id: l.id, version: l.version, where: 'installed', nodes: 0, functions: [], problem: l.state === 'ok' ? undefined : l.state, ...info(l.id, l.version), ...(repo ? { repo } : {}) })
  }
  for (const e of index) if (!out.some((x) => x.id === e.id)) out.push({ id: e.id, version: e.latest, where: 'index', nodes: 0, functions: [], repo: e.repo, ...(e.description ? { desc: e.description } : {}), ...(e.deprecated ? { deprecated: e.deprecated } : {}) })
  return out
}

/** The install review: what was downloaded, where from, its checksum and changelog. Nothing is written until Install. */
function Review({ c, onCancel, onInstalled }: { c: PackCandidate; onCancel(): void; onInstalled(c: PackCandidate): void }) {
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
    <div className="pm-detail" data-testid="pack-candidate">
      <div className="pm-head">
        <div>
          <h3 className="pm-title">{c.id}</h3>
          <div className="pm-sub">{PM.reviewTitle}</div>
        </div>
      </div>
      {c.deprecated && <p className="tone-warn">{PM.deprecated}: {c.deprecated}</p>}
      <div className="pm-card">
        <dl className="pm-facts">
          <dt>{PM.from}</dt><dd className="mono">github.com/{c.repo}</dd>
          <dt>{PM.version}</dt><dd>{c.current ? PM.change(c.current, c.version) : c.version}</dd>
          <dt>{S.nodes}</dt><dd>{c.nodes}</dd>
          <dt>{PM.checksum}</dt><dd />
        </dl>
        <div className="pm-hash">
          <code data-testid="pack-hash">{c.sha256}</code>
          <Btn onClick={copy}>{copied ? PM.copied : PM.copy}</Btn>
        </div>
        <div className="pm-hint">{PM.checksumHint}</div>
      </div>
      <div className="pm-card">
        <div className="pm-card-title">{PM.whatChanged}</div>
        {c.changelog ? <pre className="pm-changelog" data-testid="pack-changelog">{c.changelog}</pre> : <p className="pm-hint">{PM.noChangelog}</p>}
      </div>
      <div className="pm-note" role="note"><Info size={14} aria-hidden="true" />{PM.trust}</div>
      {error && <p className="tone-error" role="alert">{error}</p>}
      <div className="pm-acts pm-acts-end">
        <Btn onClick={onCancel}>{PM.cancel}</Btn>
        <Btn variant="primary" reason={busy ? PM.working : undefined} onClick={() => void install()} testId="pack-install">{c.current ? PM.update : PM.install}</Btn>
      </div>
    </div>
  )
}

/** "New local pack" form: an empty pack in `<project>/libraries/<id>/`; functions are dragged onto it in the Packs tab. Main validates the id and version. */
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
    <form className="pm-detail pack-add" onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && valid && !busy && void create()} data-testid="packs-new-form">
      <h3 className="pm-title">{PM.menuNew.replace('…', '')}</h3>
      <div className="pack-new-row">
        <div><label className="field-label" htmlFor="packs-new-id">{S.newId}</label><input id="packs-new-id" className="input" value={id} placeholder="my-pack" autoFocus autoComplete="off" spellCheck={false} onChange={(e) => setId(e.target.value)} data-testid="packs-new-id" /></div>
        <div><label className="field-label" htmlFor="packs-new-version">{S.newVersion}</label><input id="packs-new-version" className="input" value={version} autoComplete="off" onChange={(e) => setVersion(e.target.value)} /></div>
      </div>
      <div><label className="field-label" htmlFor="packs-new-desc">{S.newDescription}</label><input id="packs-new-desc" className="input" value={description} placeholder={S.newDescriptionPlaceholder} onChange={(e) => setDescription(e.target.value)} /></div>
      <p className="pm-hint">{S.newHint}</p>
      {error && <p className="tone-error" role="alert">{error}</p>}
      <div className="pack-new-foot"><Btn onClick={onCancel}>{PM.cancel}</Btn><Btn variant="primary" onClick={() => void create()} reason={valid ? (busy ? PM.working : undefined) : S.newInvalid} testId="packs-new-create">{S.newCreate}</Btn></div>
    </form>
  )
}

type Tab = 'overview' | 'nodes' | 'functions' | 'history'

const previews = new Map<string, Promise<PackResultOf>>()
type PackResultOf = Awaited<ReturnType<NonNullable<typeof inkwell>['resolvePack']>>
/** What a release holds (nodes, functions, changelog), downloaded once per release when a tab needs it. Nothing is installed; main drops the pending download with the session. */
function usePreview(repo: string | undefined, version: string, on: boolean): PackResultOf | undefined {
  const [r, setR] = useState<PackResultOf>()
  useEffect(() => {
    if (!on || !repo || !inkwell) return
    const url = `https://github.com/${repo}/releases/tag/v${version}`
    let live = true
    setR(undefined)
    const p = previews.get(url) ?? inkwell.resolvePack(url)
    previews.set(url, p)
    void p.then((x) => (x.ok || previews.delete(url), live && setR(x)))
    return () => void (live = false)
  }, [repo, version, on])
  return on ? r : undefined
}

/** The tab bodies that come from a downloaded release: Nodes and Functions of a pack that is not installed, and every pack's Version history. */
function Preview({ r, what }: { r: PackResultOf | undefined; what: 'nodes' | 'functions' | 'history' }) {
  if (!r) return <p className="pm-hint">{PM.working}</p>
  if (!r.ok) return <p className="tone-error" role="alert">{r.error}</p>
  const c = r.candidate
  if (what === 'history') return c.changelog ? <pre className="pm-changelog pm-history" data-testid="pack-changelog">{c.changelog}</pre> : <p className="pm-hint">{PM.noChangelog}</p>
  if (what === 'functions') return c.functionNames.length ? <ul className="pm-fns" role="list">{c.functionNames.map((n) => <li key={n}>{n}</li>)}</ul> : <p className="pm-hint">{PM.nothing}</p>
  const nodes = [...c.nodeList].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
  return nodes.length ? <ul className="pm-fns" role="list" data-testid="pack-nodes">{nodes.map((d, i) => <li key={i}><span>{d.title}{d.description && <span className="pm-fns-desc">{d.description}</span>}</span><span className="pm-ver">{d.category}</span></li>)}</ul> : <p className="pm-hint">{PM.nothing}</p>
}

function Flag({ e }: { e: Entry }) {
  if (e.problem) return <span className="pm-flag is-missing" title={PM.notDownloaded}><Download size={14} aria-hidden="true" /></span>
  if (e.latest) return <span className="pm-flag is-update" title={PM.updateAvailable(e.latest)}><CircleArrowUp size={14} aria-hidden="true" /></span>
  if (e.where === 'index') return <span className="pm-flag" title={PM.install}><Download size={14} aria-hidden="true" /></span>
  return <span className="pm-flag" />
}

/**
 * The pack manager (Packs tab > Manage packs). One window for finding, adding, updating and removing packs, laid out like Unity's Package Manager: a source dropdown and search above, the
 * list at the left, the selected pack and its one action at the right. Installing and updating show the review (repo, version, checksum, changelog) in the right pane; main installs only
 * a download the review showed (a token), and `packs.lock` changes only then.
 */
export function PackManager({ onClose }: { onClose(): void }) {
  const packs = useLibraryPacks()
  const { state, busy, refresh, restore } = usePackLock()
  const [index, setIndex] = useState<{ list?: PackIndexEntry[]; error?: string }>({})
  const [src, setSrc] = useState<Source>('project')
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string>()
  const [review, setReview] = useState<PackCandidate>()
  const [creating, setCreating] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [exporting, setExporting] = useState<string>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const [replace, setReplace] = useState<{ id: string; path: string }>()
  const [tab, setTab] = useState<Tab>('overview')
  const defs = usePacks()
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => void inkwell?.getPacksIndex().then((r) => setIndex(r.ok ? { list: r.index } : { error: r.error })), [])

  const entries = useMemo(() => buildEntries(packs, state.locked, index.list ?? []), [packs, state.locked, index.list])
  const updates = entries.filter((e) => e.latest).length
  const q = query.trim().toLowerCase()
  const repoQuery = looksLikeRepo(query.trim())
  const shown = entries.filter((e) => (src === 'index' ? e.where === 'index' : src === 'updates' ? e.latest : e.where !== 'index') && (!q || repoQuery || e.id.includes(q) || (e.desc ?? '').toLowerCase().includes(q)))
  const current = entries.find((e) => e.id === sel && shown.includes(e)) ?? shown[0]
  const wait = working || busy ? PM.working : undefined
  const needsPreview = !!current && (current.where === 'index' || tab === 'history') // an index pack is previewed as soon as it is picked, so its tabs show only what it holds
  const preview = usePreview(current?.repo, current ? (current.latest ?? current.version) : '', needsPreview)

  const pick = (id: string): void => (setSel(id), setTab('overview'), setReview(undefined), setCreating(false), setConfirm(false), setExporting(undefined), setError(undefined))
  const changed = (): void => (reloadPacks(), refresh())
  const fetchPack = async (input: string): Promise<void> => {
    setWorking(true)
    setError(undefined)
    const r = await inkwell!.resolvePack(input)
    setWorking(false)
    if (r.ok) (setReview(r.candidate), setCreating(false))
    else setError(r.error)
  }
  const installed = (c: PackCandidate): void => {
    setReview(undefined)
    setSrc('project')
    setQuery('')
    setSel(c.id)
    changed()
    toast({ tone: 'ok', title: PM.installed(c.id, c.version) })
  }
  const remove = async (e: Entry): Promise<void> => {
    if (!inkwell) return
    setWorking(true)
    const r = e.where === 'installed' ? await inkwell.removePack(e.id) : await inkwell.removeLibrary(e.id)
    setWorking(false)
    setConfirm(false)
    if (r.ok) (changed(), toast({ tone: 'ok', title: PM.removed(e.id) }))
    else toast({ tone: 'error', title: PM.removeFailed, text: r.error })
  }
  const exportPack = async (e: Entry): Promise<void> => {
    if (!inkwell || exporting === undefined) return
    const r = await inkwell.exportLibrary(e.id, exporting.trim() || undefined)
    if ('cancelled' in r) return
    toast(r.ok ? { tone: 'ok', title: strings.lib.exported(e.id, r.version, r.folder, r.zip) } : { tone: 'error', title: strings.lib.exportFailed, text: r.error }, r.ok ? 15000 : undefined)
    if (r.ok) (setExporting(undefined), changed())
  }
  const download = async (): Promise<void> => {
    const err = await restore()
    if (err) toast({ tone: 'error', title: strings.lib.downloadFailed, text: err })
  }
  const imported = (r: Awaited<ReturnType<NonNullable<typeof inkwell>['importLibrary']>>): void => {
    if ('cancelled' in r) return
    if (!r.ok && 'exists' in r) return setReplace({ id: r.id, path: r.path })
    setReplace(undefined)
    if (r.ok) (changed(), setSrc('project'), setSel(r.id))
    toast(r.ok ? { tone: 'ok', title: strings.lib.imported(r.id, r.functions.length) } : { tone: 'error', title: strings.lib.importFailed, text: r.error })
  }
  const group = (w: Where): Entry[] => shown.filter((e) => e.where === w)

  const row = (e: Entry) => (
    <button key={e.id} type="button" className={`pm-row${current?.id === e.id && !review && !creating ? ' is-on' : ''}`} aria-current={current?.id === e.id ? 'true' : undefined} onClick={() => pick(e.id)} data-testid={`pack-row-${e.id}`}>
      <span className="pm-name">{e.id}</span><span className="pm-ver mono">{e.version}</span><Flag e={e} />
    </button>
  )

  const actions = (e: Entry) => {
    if (confirm) return null
    const out = []
    if (e.where === 'index') out.push(<Btn key="i" variant="primary" reason={wait} onClick={() => void fetchPack(`https://github.com/${e.repo}/releases/tag/v${e.version}`)} testId="pack-start-install">{PM.install}</Btn>)
    if (e.problem) out.push(<Btn key="d" variant="primary" reason={wait} onClick={() => void download()} testId="packs-restore">{PM.download}</Btn>)
    else if (e.latest) out.push(<Btn key="u" variant="primary" reason={wait} onClick={() => void fetchPack(`https://github.com/${e.repo}/releases/tag/v${e.latest}`)} testId="pack-start-update">{PM.updateTo(e.latest)}</Btn>)
    if (e.where === 'local') out.push(<Btn key="x" reason={e.nodes ? undefined : strings.lib.exportEmpty} onClick={() => setExporting(e.version)} testId="pack-export">{strings.lib.exportOpen}</Btn>)
    if (e.where === 'installed' || e.where === 'local' || e.where === 'imported') out.push(<Btn key="r" variant="danger" onClick={() => setConfirm(true)} testId="pack-remove">{PM.remove}</Btn>)
    return out
  }

  /** What the Nodes and Functions tabs would list; an index pack is known only once its release is downloaded. */
  const countOf = (e: Entry, what: 'nodes' | 'functions'): number => {
    if (e.where === 'index') return preview?.ok ? (what === 'nodes' ? preview.candidate.nodeList.length : preview.candidate.functionNames.length) : 0
    return what === 'functions' ? e.functions.length : [...defs.keys()].filter((k) => k.startsWith(`${e.id}/`)).length
  }
  const tabsOf = (e: Entry): { id: Tab; label: string }[] => [
    { id: 'overview', label: PM.tabOverview },
    ...(countOf(e, 'nodes') ? [{ id: 'nodes' as const, label: PM.tabNodes }] : []),
    ...(countOf(e, 'functions') ? [{ id: 'functions' as const, label: PM.tabFunctions }] : []),
    ...(e.repo ? [{ id: 'history' as const, label: PM.tabHistory }] : [])
  ]
  const tabBody = (e: Entry) => {
    const t = tabsOf(e).some((x) => x.id === tab) ? tab : 'overview'
    if (e.where === 'index' && t !== 'overview') return <Preview r={preview} what={t} />
    if (t === 'nodes') {
      const nodes = [...defs.entries()].filter(([k]) => k.startsWith(`${e.id}/`)).map(([, d]) => d).sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
      return nodes.length ? <ul className="pm-fns" role="list" data-testid="pack-nodes">{nodes.map((d) => <li key={d.kind}><span>{d.title}{inspectorText(d).description && <span className="pm-fns-desc">{inspectorText(d).description}</span>}</span><span className="pm-ver">{d.category}</span></li>)}</ul> : <p className="pm-hint">{e.problem ? PM.problemHint : PM.nothing}</p>
    }
    if (t === 'functions') return <ul className="pm-fns" role="list">{e.functions.map((f) => <li key={f.id}>{f.name}</li>)}</ul>
    if (t === 'history') return <Preview r={preview} what="history" />
    return (
      <>
        {e.deprecated ? <p>{e.deprecated}</p> : (e.desc ?? PM.about[e.where]) && <p>{e.desc ?? PM.about[e.where]}</p>}
        {e.repo && (
          <dl className="pm-facts">
            <dt>{PM.repository}</dt><dd className="mono">{e.repo}</dd>
            <dt>{PM.latest}</dt><dd>{e.latest ?? e.version}</dd>
          </dl>
        )}
      </>
    )
  }

  const detail = (e: Entry) => (
    <div className="pm-detail" data-testid="pack-detail">
      <div className="pm-head">
        <div>
          <h3 className="pm-title">{e.id}</h3>
          <div className="pm-sub">{e.version} · {PM.groups[e.where]}{e.nodes ? ` · ${PM.nodes(e.nodes)}` : ''}{e.where === 'core' || e.where === 'imported' ? ` · ${PM.readOnly}` : ''}</div>
        </div>
        <div className="pm-acts">{actions(e)}</div>
      </div>
      {exporting !== undefined && e.where === 'local' && (
        <div className="pm-card" data-testid="pack-export-form">
          <label className="field-label" htmlFor="pack-export-version">{strings.lib.packVersion}</label>
          <input id="pack-export-version" className="input" value={exporting} autoComplete="off" onChange={(x) => setExporting(x.target.value)} onKeyDown={(x) => x.key === 'Enter' && void exportPack(e)} />
          <div className="pm-acts pm-acts-end"><Btn onClick={() => setExporting(undefined)}>{PM.cancel}</Btn><Btn variant="primary" onClick={() => void exportPack(e)} testId="library-export-run">{strings.lib.exportRun}</Btn></div>
        </div>
      )}
      {confirm && (
        <div className="pm-note pm-note-ask" role="alert">
          <span>{e.where === 'installed' ? PM.removeAsk(e.id) : PM.removeAskFolder(e.id)}</span>
          <span className="pm-acts"><Btn onClick={() => setConfirm(false)}>{PM.cancel}</Btn><Btn variant="danger" reason={wait} onClick={() => void remove(e)} testId="pack-remove-confirm">{PM.remove}</Btn></span>
        </div>
      )}
      {(e.problem || e.latest || (e.where !== 'index' && e.repo) || e.deprecated) && (
        <div className="pm-chips">
          {e.problem && <span className="chip chip-warn">{e.problem === 'missing' ? PM.notDownloaded : PM.changedOnDisk}</span>}
          {!e.problem && e.latest && <span className="chip chip-info">{PM.updateAvailable(e.latest)}</span>}
          {!e.problem && !e.latest && e.where === 'installed' && <span className="chip">{PM.upToDate}</span>}
          {e.deprecated && <span className="chip chip-warn">{PM.deprecated}</span>}
        </div>
      )}
      {e.problem && <p className="pm-hint">{PM.problemHint}</p>}
      <div className="pm-tabs" role="tablist">
        {tabsOf(e).map((x) => <button key={x.id} type="button" role="tab" className="tab" aria-selected={(tabsOf(e).some((y) => y.id === tab) ? tab : 'overview') === x.id} onClick={() => setTab(x.id)} data-testid={`pack-tab-${x.id}`}>{x.label}</button>)}
      </div>
      {tabBody(e)}
    </div>
  )

  return (
    <Dialog title={PM.title} onClose={onClose} wide>
      <div className="pm" data-testid="pack-manager">
        <div className="pm-bar">
          <select aria-label={PM.show} value={src} onChange={(e) => (setSrc(e.target.value as Source), setReview(undefined))} data-testid="pack-source">
            <option value="project">{PM.srcProject}</option>
            <option value="index">{PM.srcIndex}</option>
            {updates > 0 && <option value="updates">{PM.srcUpdates(updates)}</option>}
          </select>
          <label className="pm-search">
            <Search size={14} aria-hidden="true" />
            <input ref={search} className="input" value={query} placeholder={PM.searchPlaceholder} aria-label={PM.searchLabel} autoComplete="off" spellCheck={false} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && repoQuery && void fetchPack(query.trim())} data-testid="packs-search" />
          </label>
          <RowMenu
            icon={Plus}
            label={PM.add}
            testId="pack-add"
            items={[
              { label: PM.menuGithub, onClick: () => search.current?.focus() },
              { label: PM.menuImport, onClick: () => void inkwell?.importLibrary().then(imported) },
              { label: PM.menuNew, onClick: () => (setCreating(true), setReview(undefined)) }
            ]}
          />
        </div>
        {replace && (
          <p className="tone-warn" role="alert">
            {strings.lib.importReplace(replace.id)} <Btn variant="danger" onClick={() => void inkwell?.importLibrary(replace).then(imported)}>{strings.lib.replace}</Btn> <Btn onClick={() => setReplace(undefined)}>{PM.cancel}</Btn>
          </p>
        )}
        {state.lockError && <p className="tone-error" role="alert">{state.lockError}</p>}
        <div className="pm-body">
          <div className="pm-list" data-testid="packs-index">
            {repoQuery && (
              <>
                <div className="pm-grp">{PM.groups.github}</div>
                <button type="button" className="pm-row" onClick={() => void fetchPack(query.trim())} data-testid="packs-fetch"><span className="pm-name mono">{query.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '')}</span><span className="pm-ver">{PM.fetchLatest}</span><span className="pm-flag"><Download size={14} aria-hidden="true" /></span></button>
              </>
            )}
            {WHERE_ORDER.map((w) => (group(w).length ? <div key={w}><div className="pm-grp">{PM.groups[w]} ({group(w).length})</div>{group(w).map(row)}</div> : null))}
            {!shown.length && !repoQuery && <p className="pm-hint pm-empty">{src === 'index' && !index.list && !index.error ? PM.indexLoading : PM.nothing}</p>}
            {src !== 'project' && index.error && <p className="tone-error pm-empty" role="alert">{index.error}</p>}
          </div>
          {creating ? <NewPackForm onCreated={(id) => (setCreating(false), changed(), setSrc('project'), setSel(id))} onCancel={() => setCreating(false)} /> : review ? <Review c={review} onCancel={() => setReview(undefined)} onInstalled={installed} /> : current ? detail(current) : <div className="pm-detail pm-hint">{PM.pickOne}</div>}
        </div>
        {error && <p className="tone-error" role="alert">{error}</p>}
        {(working || busy) && <p className="pm-hint">{PM.working}</p>}
      </div>
    </Dialog>
  )
}
