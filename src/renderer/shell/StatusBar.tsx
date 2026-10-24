import { Check } from 'lucide-react'
import { useDockRows } from '../hooks/useProject'
import { useUndo } from '../hooks/useUndo'
import { countSeverities } from '../model/lintRows'
import { useSyncState } from '../hooks/useSyncState'
import { specLabel, timingLine } from '../model/statusBar'
import { useDialogStore } from '../state/dialogStore'
import { useTimingStore } from '../state/timingStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { formatMs } from '../model/statusBar'
import { strings } from '../strings'
import { Popover } from '../ui/Popover'
import { FigmaDot, GameDot } from './TopBar'

/** Deploy progress and the last result with its stage timings (compile, vanilla check, write). */
function DeployItem() {
  const d = useSyncState()?.deploy
  if (!d) return null
  const parts = d.timing ? Object.entries(d.timing.stages).map(([n, v]) => `${strings.status.stage(n)} ${formatMs(v)}`) : []
  return (
    <span className={`item${d.state === 'error' ? ' is-error' : ''}`} title={`${strings.status.deployTip} ${d.message}`} data-testid="deploy-status" role="status">
      {strings.status.deploy}: {d.state === 'done' && d.timing ? <strong>{formatMs(d.timing.total)}</strong> : d.state === 'error' ? 'failed' : d.message}
      {parts.length > 0 && <span className="mono"> [{parts.join(' · ')}]</span>}
    </span>
  )
}

/**
 * Zone 6B (UX 4.6): spec version, last build with every stage and the Ruffle time (amber above one second edit-to-preview; click for the
 * last 50 builds), FFDec status (warm / cold / not found, linking to the Settings view), packs, and which undo history is active.
 */
export function StatusBar() {
  const sync = useSyncState()
  const history = useTimingStore((s) => s.history)
  const last = history.at(-1)
  const line = last ? timingLine(last) : undefined
  const ffdec = sync?.ffdec
  const undo = useUndo()
  const show = useDialogStore((s) => s.show)
  const lint = countSeverities(useDockRows())
  return (
    <footer className="statusbar" aria-label={strings.status.label}>
      <span className="item" title={strings.status.specTip}><Check size={13} aria-hidden="true" /> {specLabel()}</span>
      <Popover
        up
        label={strings.status.historyTitle}
        trigger={(p) => (
          <button type="button" className={`item item-button${line?.amber ? ' is-amber' : ''}`} {...p} data-testid="timing" title={strings.status.historyTip}>
            {line ? (
              <>
                {strings.status.lastBuild}: <strong>{line.total}</strong> <span className="mono">[{line.parts.map(([n, v]) => `${strings.status.stage(n)} ${v}`).join(' · ')}]</span>
                {line.amber && <span className="amber-note"> {strings.status.overTarget}</span>}
              </>
            ) : strings.status.noBuilds}
          </button>
        )}
      >
        <div className="details history">
          <h3>{strings.status.historyTitle}</h3>
          {history.length === 0 ? (
            <p className="empty">{strings.status.noBuilds}</p>
          ) : (
            <table>
              <thead><tr>{strings.status.historyCols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
              <tbody>
                {[...history].reverse().map((r) => {
                  const l = timingLine(r)
                  return (
                    <tr key={r.seq} className={l.amber ? 'is-amber' : undefined}>
                      <td>{r.seq}</td><td>{r.swfName}</td><td className="mono">{l.total}</td>
                      <td className="mono">{l.parts.map(([n, v]) => `${strings.status.stage(n)} ${v}`).join(' · ')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <p className="dim">{strings.status.historyNote}</p>
        </div>
      </Popover>
      {ffdec?.status === 'notFound' ? (
        <button type="button" className="item item-button is-error" onClick={() => show('settings')} data-testid="ffdec" title={strings.status.openDoctor}>
          {strings.status.ffdecNotFound}
        </button>
      ) : (
        <span className="item" data-testid="ffdec">{strings.status.ffdec(ffdec?.status)}</span>
      )}
      <button type="button" className={`item item-button${lint.errors ? ' is-error' : ''}`} onClick={() => useWorkspaceStore.getState().showDockTab('lintBudget')} title={strings.status.lintTip} data-testid="lint-counts">
        {strings.status.lint(lint.errors, lint.warnings)}
      </button>
      {sync?.deploy && <DeployItem />}
      <span className="item">{strings.status.packs}</span>
      <span className="spacer" />
      <FigmaDot />
      <GameDot />
      <span className="item" title={strings.status.undoTip(undo.swfName)} data-testid="undo-scope">{strings.status.undo}</span>
    </footer>
  )
}
