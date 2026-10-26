import { Check } from 'lucide-react'
import { useActiveSwf, useDockRows, useProject } from '../hooks/useProject'
import { usePackList } from '../hooks/usePacks'
import { usePreviewBuilds } from '../hooks/usePreviewBuilds'
import type { SnapshotInfo } from '../../shared/projectState'
import { figmaConnection, type DotTone } from '../model/connection'
import { useSettingsStore } from '../state/settingsStore'
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
import { GameDot } from './GameDot'

function Dot({ tone }: { tone: DotTone }) {
  return <span className={`dot dot-${tone}`} aria-hidden="true" />
}

/** Connection dots live in the status bar (Zone 6B), so their popovers open upward. */
export function FigmaDot() {
  const sync = useSyncState()
  const project = useProject()
  const snap = project?.snapshot
  const c = figmaConnection(sync, snap)
  const mirror = useSettingsStore((s) => s.mirrorFigma)
  const setMirror = useSettingsStore((s) => s.setMirrorFigma)
  const label = strings.top.figmaStatus[c.status]
  return (
    <Popover
      label={strings.top.figmaDetails}
      align="end"
      up
      trigger={(p) => (
        <button type="button" className="item item-fixed item-button" {...p} title={`${strings.top.figma}: ${label}`} aria-label={`${strings.top.figma}: ${label}`} data-testid="dot-figma" data-tone={c.tone}>
          <Dot tone={c.tone} /> {strings.top.figma}
        </button>
      )}
    >
      <div className="details">
        <p><strong>{label}</strong></p>
        {sync?.connectionIssue && <p className={c.tone === 'error' ? 'tone-error' : 'tone-warn'}>{sync.connectionIssue.message}</p>}
        {sync?.server === 'error' && <p className="tone-error">{strings.top.serverError(sync.error)}</p>}
        {project && <SnapshotFacts snap={snap} />}
        <dl className="facts">
          <dt>{strings.syncPort}</dt><dd className="mono">{sync?.port ?? '-'}</dd>
        </dl>
        <p className="dim">{strings.top.approvalNote}</p>
        <label className="check">
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} data-testid="mirror-setting" /> {strings.top.mirror}
        </label>
        <p className="dim">{strings.top.mirrorNote}</p>
      </div>
    </Popover>
  )
}

function SnapshotFacts({ snap }: { snap: SnapshotInfo | undefined }) {
  return (
    <div data-testid="snapshot-facts">
      <h3>{strings.top.snapshotTitle}</h3>
      {!snap ? <p className="dim">{strings.top.snapshotNone}</p>
        : snap.error ? <p className="tone-warn">{strings.top.snapshotBroken(snap.error)}</p>
          : (
            <>
              <p className="dim">{strings.top.snapshotSaved(new Date(snap.updatedAt).toLocaleString(), snap.swfs)}. {strings.top.snapshotFrom(snap.pluginVersion, snap.fileKey)}</p>
              {snap.stale.length > 0 && <p className="tone-warn">{strings.top.snapshotStale(snap.stale)}</p>}
            </>
          )}
    </div>
  )
}

/** Deploy progress and the last result with its stage timings (compile, vanilla check, write). */
function DeployItem() {
  const d = useSyncState()?.deploy
  if (!d) return null
  const parts = d.timing ? Object.entries(d.timing.stages).map(([n, v]) => `${strings.status.stage(n)} ${formatMs(v)}`) : []
  return (
    <span className={`item${d.state === 'error' ? ' is-error' : ''}`} title={`${strings.status.deployTip} ${d.message}`} data-testid="deploy-status" role="status">
      {strings.status.deploy}: {d.state === 'done' && d.timing ? <strong>{formatMs(d.timing.total)}</strong> : d.state === 'error' ? 'failed' : d.message}
      {parts.length > 0 && <span className="mono"> [{parts.join(' · ')}]</span>}
      {d.hotReload && <span data-testid="deploy-hot-reload"> · {d.hotReload}</span>}
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
  const packs = usePackList()
  const lint = countSeverities(useDockRows())
  const swf = useActiveSwf()
  const entries = usePreviewBuilds()
  const entry = entries.find((e) => e.latest.swfId === swf?.id) ?? (swf ? undefined : entries[0])
  const failed = sync?.build === 'error' || !!entry?.stale
  const lastGood = entry?.shownAt !== undefined ? strings.stage.lastGood(new Date(entry.shownAt).toLocaleTimeString()) : undefined
  return (
    <footer className="statusbar" aria-label={strings.status.label}>
      <span className="item" title={strings.status.specTip}><Check size={13} aria-hidden="true" /> {specLabel()}</span>
      {lastGood && <span className={`item ${failed ? 'is-error' : ''}`} data-testid="last-good" title={lastGood}><Dot tone={failed ? 'error' : 'ok'} /> {lastGood}</span>}
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
      <span className="item">{strings.status.packs(packs)}</span>
      <span className="spacer" />
      <FigmaDot />
      <GameDot />
      <span className="item item-fixed" title={strings.status.undoTip(undo.swfName)} data-testid="undo-scope">{strings.status.undo}</span>
    </footer>
  )
}
