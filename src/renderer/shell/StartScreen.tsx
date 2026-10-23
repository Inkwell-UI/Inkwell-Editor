import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus, PenLine, Sparkles } from 'lucide-react'
import { PRODUCT_NAME } from '../../shared/product'
import type { OpenResult, RecentProject } from '../../shared/projectState'
import { inkwell } from '../hooks/api'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'

/** First launch / no project (UX 5.4): New Project, Open Project, an example project, and the recent projects (kept in userData by main). */
export function StartScreen() {
  const [recent, setRecent] = useState<RecentProject[]>([])
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
  return (
    <main className="start" aria-labelledby="start-title">
      <div className="start-card">
        <h1 id="start-title"><PenLine size={22} aria-hidden="true" /> {PRODUCT_NAME}</h1>
        <p className="dim">{strings.start.tagline}</p>
        <div className="start-actions">
          <Btn icon={FolderPlus} variant="primary" reason={noApi ?? (busy ? strings.start.busy : undefined)} onClick={() => void run(() => inkwell?.newProject(strings.start.newDialog))} testId="start-new">{strings.start.newProject}</Btn>
          <Btn icon={FolderOpen} reason={noApi ?? (busy ? strings.start.busy : undefined)} onClick={() => void run(() => inkwell?.openProject(undefined, strings.start.openDialog))} testId="start-open">{strings.start.openProject}</Btn>
          <Btn icon={Sparkles} reason={noApi ?? (busy ? strings.start.busy : undefined)} onClick={() => void run(() => inkwell?.openExample(strings.start.exampleDialog))} testId="start-example">{strings.start.example}</Btn>
        </div>
        <p className="dim">{strings.start.exampleNote}</p>
        {error && <p role="alert" className="tone-error">{error}</p>}
        <section aria-labelledby="recent-title">
          <h2 id="recent-title">{strings.start.recent}</h2>
          {recent.length === 0 ? (
            <p className="empty">{strings.start.noRecent}</p>
          ) : (
            <ul className="recent">
              {recent.map((r) => (
                <li key={r.dir}>
                  <button type="button" className="recent-item" onClick={() => void run(() => inkwell?.openProject(r.dir, strings.start.openDialog))} title={r.dir}>
                    <strong>{r.name}</strong>
                    <span className="dim mono">{r.dir}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
