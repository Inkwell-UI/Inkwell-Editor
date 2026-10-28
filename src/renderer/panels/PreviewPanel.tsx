import { useEffect, useState, useSyncExternalStore } from 'react'
import { CircleX, Link2Off, WifiOff } from 'lucide-react'
import type { AspectId } from '../../shared/preview'
import { inkwell } from '../hooks/api'
import { useElementSize } from '../hooks/useElementSize'
import { usePreviewBuilds } from '../hooks/usePreviewBuilds'
import { useActiveOverlay, useActiveSwf, useDockRows, useProject } from '../hooks/useProject'
import { useSyncState } from '../hooks/useSyncState'
import { usableSnapshot } from '../model/connection'
import { firstError } from '../model/lintRows'
import { AspectFrame } from '../preview/AspectFrame'
import { mockDataOf } from '../../shared/graphBinding'
import { createPreviewController, type PreviewController } from '../preview/controller'
import { deliverMock } from '../preview/mockDelivery'
import { previewBus } from '../preview/previewBus'
import { stepZoom } from '../preview/geometry'
import { InspectOverlay } from '../preview/InspectOverlay'
import { FocusGraphOverlay } from '../preview/FocusGraphOverlay'
import { promptPreviewStore } from '../preview/prompts'
import { hasFocusGraph } from '../../main/lint/focus'
import { RuffleBackend } from '../preview/RuffleBackend'
import { SafeZoneOverlay } from '../preview/SafeZoneOverlay'
import { StageToolbar, type StageMode } from '../preview/StageToolbar'
import { uiScaleStore } from '../preview/uiScale'
import { localeStore } from '../preview/locale'
import { useLocalizationStore } from '../state/localizationStore'
import { SwfViewport } from '../preview/SwfViewport'
import { useLintStore } from '../state/lintStore'
import { isPreviewWindow, usePopoutStore } from '../state/popoutStore'
import { useProjectStore } from '../state/projectStore'
import { useTraceStore } from '../state/traceStore'
import { useSelectionStore } from '../state/selectionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

const idle = { status: 'idle' as const }
const COMPACT_BELOW = 300 // px of panel height (the fixed preview slot of Behaviour mode) ...
const COMPACT_NARROW = 400 // ... or width (a narrow column)

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
  const [paused, setPaused] = useState(false)
  const [focusOn, setFocusOn] = useState(false)
  const [ctl, setCtl] = useState<PreviewController>()
  const [rootRef, rootSize] = useElementSize<HTMLDivElement>()

  useEffect(() => {
    const c = createPreviewController({ backend: new RuffleBackend(), report: (r) => inkwell?.reportPreviewRendered(r) })
    setCtl(c)
    // trace output and the Play panel / mock data bridge (docs/debugging.md)
    const offs = [c.backend.on('trace', (raw) => useTraceStore.getState().push(raw)), previewBus.attach(c.backend)]
    return () => (offs.forEach((off) => off()), c.dispose())
  }, [])

  const entry = entries.find((e) => e.latest.swfId === swf?.id) ?? (swf ? undefined : entries[0])
  const build = entry?.shown
  useEffect(() => {
    if (ctl && build) {
      useTraceStore.getState().newBuild() // pin values belong to the build that traced them
      void ctl.show(build)
    }
  }, [ctl, build])
  const state = useSyncExternalStore(ctl?.subscribe ?? (() => () => {}), ctl?.getState ?? (() => idle))
  useEffect(() => {
    if (state.status === 'loading') setPaused(false) // every load (build, reload) creates a playing movie
  }, [state.status])
  // Mock data feeds the running movie, never a build: after every load (a rebuild restarts the movie) and whenever the data changes.
  const mockJson = JSON.stringify(mockDataOf(useActiveOverlay()))
  useEffect(() => {
    if (ctl && state.status === 'ready') deliverMock(ctl.backend, JSON.parse(mockJson) as Record<string, string | number | boolean>)
  }, [ctl, state.status, state.seq, mockJson])
  // a rebuild restarts the movie at scale 1: bring the chosen UI scale back (custom menus only; the callback does not exist in other previews)
  useEffect(() => {
    if (ctl && state.status === 'ready' && swf?.ir.target.kind === 'customMenu') uiScaleStore.reapply()
  }, [ctl, state.status, state.seq, swf?.ir.target.kind])

  // the chosen locale and Pseudo-Loc live in the mock data of the running movie: after the mock reset of every load (and when the table changes) bring them back
  const table = useLocalizationStore((s) => s.localization)
  useEffect(() => {
    if (ctl && state.status === 'ready' && swf?.ir.target.kind === 'customMenu') localeStore.reapply(table)
  }, [ctl, state.status, state.seq, swf?.ir.target.kind, table])

  // W4: the Prompts preview choice lives in the mock data too
  useEffect(() => {
    if (ctl && state.status === 'ready' && swf?.ir.target.kind === 'customMenu') promptPreviewStore.reapply()
  }, [ctl, state.status, state.seq, swf?.ir.target.kind])
  const isMenu = swf?.ir.target.kind === 'customMenu'
  const overlayNodes = useActiveOverlay()?.nodes
  const padKeys = isMenu && hasFocusGraph(overlayNodes ?? {})

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
    // W3 pad emulation: in Play mode a menu with a focus graph gets arrows and Enter as the d-pad and A (the runtime's On Input plus GFx's press), not as Ruffle's own keys
    const pad = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Accept' }[e.key]
    if (pad && mode === 'play' && padKeys && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      previewBus.call('inkwellPad', pad)
      return
    }
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault() // Tab toggles Inspect/Play while the stage has focus; Shift+Tab leaves it
      setMode((m) => (m === 'inspect' ? 'play' : 'inspect'))
    }
  }

  let emptyMessage: string | undefined
  if (project && project.swfs.length === 0) emptyMessage = strings.stage.noSwfs
  else if (!build) emptyMessage = entry?.latest.error ? `${strings.previewError}: ${entry.latest.error}` : swf?.orphaned ? strings.stage.orphaned : strings.previewNone

  const compact = rootSize.height > 0 && (rootSize.height < COMPACT_BELOW || rootSize.width < COMPACT_NARROW)
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
        <div className="banner banner-info" data-testid="snapshot-banner" data-snapshot={usableSnapshot(project.snapshot) ? 'yes' : 'no'} title={usableSnapshot(project.snapshot) ? strings.stage.snapshot : strings.stage.noSnapshot}>
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
          paused={paused}
          onPaused={(v) => (ctl?.backend.setPaused(v), setPaused(v))}
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
          {...(isMenu ? { menuControls: true, focusGraph: { on: focusOn, onToggle: () => setFocusOn(!focusOn) } } : {})}
        />
        {!compact && banners}
        <div className="preview-stage" tabIndex={0} role="group" aria-label={strings.stage.stageLabel} onKeyDownCapture={onStageKey} data-mode={mode} data-testid="stage">
          {compact && <div className="stage-banners">{banners}</div>}
          <div className="stage-scroll">
            <div className="stage-zoom" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
              {ctl && build?.bytes ? (
                <AspectFrame aspect={aspect}>
                  <SwfViewport backend={ctl.backend} stage={build.stage} />
                  {swf && <InspectOverlay ir={swf.ir} stage={build.stage} active={mode === 'inspect' && !(isMenu && focusOn)} selected={selected} onSelect={(id) => select(id, 'stage')} />}
                  {swf && isMenu && focusOn && <FocusGraphOverlay ir={swf.ir} swfId={swf.id} swfName={swf.name} stage={build.stage} active={mode === 'inspect'} onSelect={(id) => select(id, 'stage')} />}
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
      </div>
    </Panel>
  )
}
