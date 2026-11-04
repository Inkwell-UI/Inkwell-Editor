import { Check, Pause, Play } from 'lucide-react'
import { useActiveSwf, useDockRows, useProject } from '../hooks/useProject'
import { usePackList } from '../hooks/usePacks'
import { usePreviewBuilds } from '../hooks/usePreviewBuilds'
import { figmaConnection, usableSnapshot, type DotTone } from '../model/connection'
import { inkwell } from '../hooks/api'
import { useSettingsStore } from '../state/settingsStore'
import { countSeverities } from '../model/lintRows'
import { useSyncState } from '../hooks/useSyncState'
import { specLabel, timingLine } from '../model/statusBar'
import { useDialogStore } from '../state/dialogStore'
import { useTimingStore } from '../state/timingStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { formatMs } from '../model/statusBar'
import { strings } from '../../shared/strings'
import { Btn } from '../ui/Btn'
import { Popover } from '../ui/Popover'
import { BuildPopup } from './BuildPopup'
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
  const t = strings.top
  const label = t.figmaStatus[c.status]
  const chip = c.status === 'snapshot' ? t.figmaStatus['disconnected'] : label // the Source row says "Snapshot"
  const paused = !!sync?.paused
  const held = sync?.heldChanges ?? 0
  const live = (sync?.connections ?? 0) > 0
  const usable = usableSnapshot(snap)
  const showHint = c.status === 'snapshot' || c.status === 'disconnected'
  return (
    <Popover
      label={t.figmaDetails}
      align="end"
      up
      trigger={(p) => (
        <button type="button" className="item item-fixed item-button" {...p} title={`${t.figma}: ${label}`} aria-label={`${t.figma}: ${label}`} data-testid="dot-figma" data-tone={c.tone}>
          <Dot tone={c.tone} /> {t.figma}
        </button>
      )}
    >
      <div className="details conn">
        <div className="conn-head">
          <Dot tone={c.tone} />
          <strong>{t.figma}</strong>
          <span className="conn-status" data-testid="figma-status">{chip}</span>
        </div>
        {sync?.connectionIssue && <p className={c.tone === 'error' ? 'tone-error' : 'tone-warn'}>{sync.connectionIssue.message}</p>}
        {sync?.server === 'error' && <p className="tone-error">{t.serverError(sync.error)}</p>}
        {project && (
          <dl className="conn-facts" data-testid="snapshot-facts">
            <dt>{t.figmaSource}</dt>
            <dd title={t.figmaSourceTip}>{live && usable ? t.figmaSourceLive(snap!.swfs) : usable ? t.figmaSourceSnapshot(snap!.swfs) : t.figmaSourceNone}</dd>
            {usable && <><dt>{t.figmaLastSync}</dt><dd>{new Date(snap!.updatedAt).toLocaleString()}</dd></>}
            {paused && held > 0 && <><dt>{t.figmaWaiting}</dt><dd>{t.figmaWaitingCount(held)}</dd></>}
            {snap?.pluginVersion && <><dt>{t.figmaPlugin}</dt><dd>{snap.pluginVersion}</dd></>}
            <dt>{strings.syncPort}</dt><dd className="mono">127.0.0.1:{sync?.port ?? '-'}</dd>
          </dl>
        )}
        {project && snap?.error && <p className="tone-warn">{t.snapshotBroken(snap.error)}</p>}
        {project && snap && snap.stale.length > 0 && <p className="tone-warn">{t.snapshotStale(snap.stale)}</p>}
        {showHint && <p className="conn-hint"><strong>{t.connectHint}</strong> {t.connectHintMore}</p>}
        <div className="conn-actions">
          <Btn
            icon={mirror ? Check : undefined}
            pressed={mirror}
            label={`${t.mirrorShort}: ${t.mirrorNote}`}
            reason={paused ? t.mirrorPaused : undefined}
            onClick={() => setMirror(!mirror)}
            testId="mirror-setting"
          >
            {t.mirrorShort}
          </Btn>
          <Btn
            icon={paused ? Play : Pause}
            pressed={paused}
            label={`${paused ? t.resume : t.pause}: ${paused ? t.resumeTip(held) : t.pauseTip}`}
            onClick={() => void inkwell?.setFigmaPaused(!paused)}
            testId="figma-pause"
            className="icon-filled"
          >
            {paused ? t.resume : t.pause}
          </Btn>
        </div>
      </div>
    </Popover>
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
 * Zone 6B (UX 4.6): spec version, last build with every stage and the Ruffle time (amber above the 3 s edit-to-preview target; click for the
 * last 50 builds), FFDec status (warm / cold / not found, linking to the Settings view) and packs.
 */
export function StatusBar() {
  const sync = useSyncState()
  const history = useTimingStore((s) => s.history)
  const last = history.at(-1)
  const line = last ? timingLine(last) : undefined
  const ffdec = sync?.ffdec
  const show = useDialogStore((s) => s.show)
  const packs = usePackList()
  const lint = countSeverities(useDockRows())
  const swf = useActiveSwf()
  const entries = usePreviewBuilds()
  const entry = entries.find((e) => e.latest.swfId === swf?.id) ?? (swf ? undefined : entries[0])
  const failed = sync?.build === 'error' || !!entry?.stale
  const lastGoodAt = entry?.shownAt !== undefined ? new Date(entry.shownAt).toLocaleTimeString() : undefined
  const summary = line ? `${strings.status.lastBuild}: ${line.total} [${line.parts.map(([n, v]) => `${strings.status.stage(n)} ${v}`).join(' · ')}]` : strings.status.noBuilds
  const tone: DotTone = failed ? 'error' : !line ? 'off' : line.amber ? 'warn' : 'ok'
  return (
    <footer className="statusbar" aria-label={strings.status.label}>
      <Popover
        up
        label={strings.status.build}
        trigger={(p) => (
          <button type="button" className={`item item-button${failed ? ' is-error' : ''}`} {...p} data-testid="timing" title={summary}>
            <Dot tone={tone} /> {strings.status.build}
            <span className="sr-only">: {summary}</span>
          </button>
        )}
      >
        <BuildPopup history={history} lastGoodAt={lastGoodAt} failed={failed} />
      </Popover>
      {ffdec?.status === 'notFound' && (
        <button type="button" className="item item-button is-error" onClick={() => show('settings')} data-testid="ffdec" title={strings.status.openDoctor}>
          {strings.status.ffdecNotFound}
        </button>
      )}
      <button type="button" className={`item item-button${lint.errors ? ' is-error' : ''}`} onClick={() => useWorkspaceStore.getState().showDockTab('lintBudget')} title={strings.status.lintTip} data-testid="lint-counts">
        <Dot tone={lint.errors ? 'error' : lint.warnings ? 'warn' : 'ok'} /> {strings.status.lint(lint.errors, lint.warnings)}
      </button>
      {sync?.deploy && <DeployItem />}
      <Popover
        up
        label={strings.status.environment}
        trigger={(p) => (
          <button type="button" className="item item-button" {...p} data-testid="environment">
            <Check size={13} aria-hidden="true" /> {strings.status.environment}
          </button>
        )}
      >
        <div className="details">
          <p title={strings.status.specTip}>{specLabel()}</p>
          <p>{strings.status.ffdec(ffdec?.status)}</p>
          <p>{strings.status.packs(packs)}</p>
        </div>
      </Popover>
      <span className="spacer" />
      <FigmaDot />
      <GameDot />
    </footer>
  )
}
