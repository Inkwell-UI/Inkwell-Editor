import { useEffect, useState, useSyncExternalStore } from 'react'
import { CircleX, Link2Off, WifiOff } from 'lucide-react'
import type { AspectId } from '../../shared/preview'
import { inkwell } from '../hooks/api'
import { useElementSize } from '../hooks/useElementSize'
import { usePreviewBuilds } from '../hooks/usePreviewBuilds'
import { useActiveSwf, useDockRows, useProject } from '../hooks/useProject'
import { useSyncState } from '../hooks/useSyncState'
import { usableSnapshot } from '../model/connection'
import { firstError } from '../model/lintRows'
import { AspectFrame } from '../preview/AspectFrame'
import { createPreviewController, type PreviewController } from '../preview/controller'
import { stepZoom } from '../preview/geometry'
import { InspectOverlay } from '../preview/InspectOverlay'
import { RuffleBackend } from '../preview/RuffleBackend'
import { SafeZoneOverlay } from '../preview/SafeZoneOverlay'
import { ShimBadge } from '../preview/ShimBadge'
import { StageToolbar, type StageMode } from '../preview/StageToolbar'
import { SwfViewport } from '../preview/SwfViewport'
import { useLintStore } from '../state/lintStore'
import { isPreviewWindow, usePopoutStore } from '../state/popoutStore'
import { useProjectStore } from '../state/projectStore'
import { useSelectionStore } from '../state/selectionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

const idle = { status: 'idle' as const }
const COMPACT_BELOW = 300 // px of panel height: the Behaviour mode's strip

/**
 * Zone 3, the preview stage (UX 4.3): stage toolbar, the simulated screen with the stage fitted inside, safe zones, the Inspect overlay,
 * the Ruffle/GFx note with the active shims, the last-good-build indicator and the banners (build failed, Figma not connected, no SWFs).
 * Data: usePreviewBuilds() (keeps the last good build), the project (IR for Inspect), the sync state. The same component runs in the
 * popped-out window (`isPreviewWindow()`), where the toolbar shows "Dock" and a SWF picker.
 * The backend is created here (RuffleBackend is the only 1.0 implementation; swap the line to plug in another PreviewBackend).
 */
export function PreviewPanel() {
  const entries = usePreviewBuilds()
  const project = useProject()
  const swf = useActiveSwf()
  const sync = useSyncState()
  const dock = useDockRows()
  const detached = usePopoutStore((s) => s.detached)
  const inWindow = isPreviewWindow()
  const selected = useSelectionStore((s) => s.component)
  const select = useSelectionStore((s) => s.selectComponent)
  const [mode, setMode] = useState<StageMode>('inspect')
  const [aspect, setAspect] = useState<AspectId>('16:9')
  const [safe, setSafe] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [ctl, setCtl] = useState<PreviewController>()
  const [rootRef, rootSize] = useElementSize<HTMLDivElement>()

  useEffect(() => {
    const c = createPreviewController({ backend: new RuffleBackend(), report: (r) => inkwell?.reportPreviewRendered(r) })
    setCtl(c)
    return () => c.dispose()
  }, [])

  const entry = entries.find((e) => e.latest.swfId === swf?.id) ?? (swf ? undefined : entries[0])
  const build = entry?.shown
  useEffect(() => {
    if (ctl && build) void ctl.show(build)
  }, [ctl, build])
  const state = useSyncExternalStore(ctl?.subscribe ?? (() => () => {}), ctl?.getState ?? (() => idle))

  const failed = sync?.build === 'error' || !!entry?.stale
  const err = firstError(dock)
  const jumpToError = (): void => {
    useLintStore.getState().showAll()
    useWorkspaceStore.getState().showDockTab('lintBudget')
    if (!err) return
    const target = project?.swfs.find((s) => s.name === err.swfName)
    if (target) useProjectStore.getState().setActiveSwf(target.id)
    if (err.nodeId) useSelectionStore.getState().selectFromLint({ key: err.key, nodeId: err.nodeId })
  }
  const picker =
    entries.length > 1 || inWindow ? (
      <label className="inline">
        <span className="sr-only">{strings.previewSwf}</span>
        <select value={swf?.id ?? ''} onChange={(e) => useProjectStore.getState().setActiveSwf(e.target.value)} aria-label={strings.previewSwf} title={strings.previewSwf}>
          {(project?.swfs ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
    ) : undefined

  const onStageKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault() // Tab toggles Inspect/Play while the stage has focus; Shift+Tab leaves it
      setMode((m) => (m === 'inspect' ? 'play' : 'inspect'))
    }
  }

  let emptyMessage: string | undefined
  if (project && project.swfs.length === 0) emptyMessage = strings.stage.noSwfs
  else if (!build) emptyMessage = entry?.latest.error ? `${strings.previewError}: ${entry.latest.error}` : swf?.orphaned ? strings.stage.orphaned : strings.previewNone

  const compact = rootSize.height > 0 && rootSize.height < COMPACT_BELOW
  const banners = (
    <>
        {failed && (
        <div className="banner banner-error" role="alert" data-testid="build-failed">
          <CircleX size={14} aria-hidden="true" />
          <span title={build ? strings.stage.buildFailedLastGood : strings.stage.buildFailedNone}>{build ? strings.stage.buildFailedLastGood : strings.stage.buildFailedNone}</span>
          {!inWindow && <Btn onClick={jumpToError} reason={err ? undefined : strings.stage.noErrorRow} testId="show-error">{strings.stage.showError}</Btn>}
        </div>
      )}
      {project && sync && sync.server === 'listening' && sync.connections === 0 && (
        <div className="banner banner-info" data-testid="snapshot-banner" data-snapshot={usableSnapshot(project.snapshot) ? 'yes' : 'no'}>
          <WifiOff size={14} aria-hidden="true" />
          {usableSnapshot(project.snapshot) ? <span title={strings.stage.snapshot}>{strings.stage.snapshot}</span> : <span title={strings.stage.noSnapshot}>{strings.stage.noSnapshot}</span>}
          <Btn icon={Link2Off} reason={strings.stage.setupGuideReason}>{strings.stage.setupGuide}</Btn>
        </div>
      )}
    </>
  )
  return (
    <Panel title={strings.panelPreview}>
      <div className={`preview-panel${compact ? ' is-compact' : ''}`} ref={rootRef}>
        <StageToolbar
          mode={mode}
          onMode={setMode}
          aspect={aspect}
          onAspect={setAspect}
          safeZones={safe}
          onSafeZones={setSafe}
          onReload={() => void ctl?.reload()}
          detached={inWindow}
          onPopout={() => void inkwell?.setPreviewDetached(!inWindow && !detached)}
          zoom={zoom}
          onZoom={(d) => setZoom((z) => stepZoom(z, d))}
          onZoomReset={() => setZoom(1)}
          compact={compact}
          swfPicker={picker}
        />
        {!compact && banners}
        <div className="preview-stage" tabIndex={0} role="group" aria-label={strings.stage.stageLabel} onKeyDownCapture={onStageKey} data-mode={mode} data-testid="stage">
          {compact && <div className="stage-banners">{banners}</div>}
          <div className="stage-scroll">
            <div className="stage-zoom" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
              {ctl && build?.bytes ? (
                <AspectFrame aspect={aspect}>
                  <SwfViewport backend={ctl.backend} stage={build.stage} />
                  {swf && <InspectOverlay ir={swf.ir} stage={build.stage} active={mode === 'inspect'} selected={selected} onSelect={(id) => select(id, 'stage')} />}
                  <SafeZoneOverlay visible={safe} />
                </AspectFrame>
              ) : (
                <p className="preview-message stage-empty">{emptyMessage}</p>
              )}
            </div>
          </div>
          {state.status === 'loading' && <p className="preview-status">{strings.previewLoading}</p>}
          {state.status === 'error' && build?.bytes && <p className="preview-message">{strings.previewError}: {state.error}</p>}
          <span className="mode-chip" aria-live="polite">{mode === 'inspect' ? strings.stage.modeInspect : strings.stage.modePlay}</span>
        </div>
        <div className="stage-foot">
          <ShimBadge {...(build ? { notes: build.notes } : {})} />
          {entry?.shownAt !== undefined && (
            <span className={`chip ${failed ? 'chip-error' : 'chip-ok'}`} data-testid="last-good">
              <span className="dot" aria-hidden="true" /> {strings.stage.lastGood(new Date(entry.shownAt).toLocaleTimeString())}
            </span>
          )}
        </div>
      </div>
    </Panel>
  )
}
