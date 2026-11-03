import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus, PenLine, BrushCleaning } from 'lucide-react'
import { PRODUCT_NAME } from '../../shared/product'
import type { OpenResult, RecentProject } from '../../shared/projectState'
import { inkwell } from '../hooks/api'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'

const SHOWN = 6

/** "Today", "Yesterday", "3 days ago", then the date. */
function openedLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (Number.isNaN(days)) return ''
  if (days <= 0) return strings.start.today
  if (days === 1) return strings.start.yesterday
  return days < 7 ? strings.start.daysAgo(days) : new Date(iso).toLocaleDateString()
}

/** First launch / no project (UX 5.4): New Project, Open Project and the recent projects (kept in userData by main). */
export function StartScreen() {
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [all, setAll] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void inkwell?.getRecentProjects().then(setRecent)
  }, [])
  const run = async (fn: () => Promise<OpenResult> | undefined): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const r = await fn()
    setBusy(false)
    if (r && !r.ok && !('cancelled' in r)) setError(r.error)
  }
  const noApi = inkwell ? undefined : strings.start.noElectron
  const reason = noApi ?? (busy ? strings.start.busy : undefined)
  const shown = all ? recent : recent.slice(0, SHOWN)
  return (
    <main className="start" aria-labelledby="start-title">
      <div className="start-grid">
        <div className="start-intro">
          <h1 id="start-title"><PenLine size={22} aria-hidden="true" /> {PRODUCT_NAME}</h1>
          <p className="dim">{strings.start.tagline}</p>
          <div className="start-actions">
            <Btn icon={FolderPlus} variant="primary" reason={reason} onClick={() => void run(() => inkwell?.newProject(strings.start.newDialog))} testId="start-new">{strings.start.newProject}</Btn>
            <Btn icon={FolderOpen} reason={reason} onClick={() => void run(() => inkwell?.openProject(undefined, strings.start.openDialog))} testId="start-open">{strings.start.openProject}</Btn>
          </div>
          {error && <p role="alert" className="tone-error">{error}</p>}
        </div>
        <section className="start-recent-panel" aria-labelledby="recent-title">
          <h2 id="recent-title">{strings.start.recent}</h2>
          {recent.length === 0 ? (
            <p className="empty">{strings.start.noRecent}</p>
          ) : (
            <ul className="start-recent">
              {shown.map((r) => (
                <li key={r.dir}>
                  <button type="button" className="start-recent-item" onClick={() => void run(() => inkwell?.openProject(r.dir, strings.start.openDialog))} title={r.dir}>
                    <span className="start-recent-name">{r.name}</span>
                    <span className="start-recent-path"><bdi>{r.dir}</bdi></span>
                    <span className="start-recent-when">{openedLabel(r.openedAt)}</span>
                  </button>
                  <Btn icon={BrushCleaning} variant="quiet" label={strings.start.forget} className="start-recent-forget btn-hover-err" onClick={() => void inkwell?.forgetRecentProject(r.dir).then(setRecent)} />
                </li>
              ))}
            </ul>
          )}
          {recent.length > SHOWN && (
            <Btn variant="quiet" className="start-recent-more" onClick={() => setAll(!all)}>{all ? strings.start.showLess : strings.start.showAll(recent.length)}</Btn>
          )}
        </section>
      </div>
    </main>
  )
}
