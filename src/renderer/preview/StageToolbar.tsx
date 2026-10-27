import { useState, type ReactNode } from 'react'
import { Crosshair, Ellipsis, Keyboard, Languages, MousePointer2, PictureInPicture2, Play, RefreshCw, ScanLine, Sparkles, Waypoints, ZoomIn, ZoomOut } from 'lucide-react'
import { ASPECTS, type AspectId } from '../../shared/preview'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { ThemeControl } from './ThemeControl'

export type StageMode = 'inspect' | 'play'

/** Props of StageToolbar. All state lives in the parent (PreviewPanel). */
export interface StageToolbarProps {
  mode: StageMode
  onMode(m: StageMode): void
  aspect: AspectId
  onAspect(a: AspectId): void
  safeZones: boolean
  onSafeZones(on: boolean): void
  onReload(): void
  /** The popped-out window shows "Dock" instead of "Pop out". */
  detached: boolean
  onPopout(): void
  zoom: number
  onZoom(dir: 1 | -1): void
  onZoomReset(): void
  /** A small slot (the fixed preview of the Behaviour mode): icon-only essentials (Inspect/Play, SWF, aspect, reload, pop out); zoom and the long toggles sit in a "More" popover. */
  compact: boolean
  /** SWF picker (the detached window has no top bar). */
  swfPicker?: ReactNode
  /** Custom menu only: the UI Scale control (S9); sits in the More popover of the compact toolbar. */
  menuControls?: ReactNode
}

/**
 * The stage toolbar of UX 4.3. Controls whose feature arrives later are shown DISABLED with a one-line reason, never hidden
 * (Occupied HUD, Focus Graph, Prompts, Theme, Locale, Pseudo-Loc).
 */
export function StageToolbar(p: StageToolbarProps) {
  const [more, setMore] = useState(false)
  const secondary = (
    <>
      {p.menuControls}
      <span className="zoom" role="group" aria-label={strings.stage.zoom}>
        <Btn icon={ZoomOut} label={strings.stage.zoomOut} onClick={() => p.onZoom(-1)} />
        <button type="button" className="btn btn-quiet zoom-value" onClick={p.onZoomReset} title={strings.stage.zoomReset} aria-label={strings.stage.zoomReset}>{Math.round(p.zoom * 100)}%</button>
        <Btn icon={ZoomIn} label={strings.stage.zoomIn} onClick={() => p.onZoom(1)} />
      </span>
      <Btn icon={ScanLine} pressed={p.safeZones} onClick={() => p.onSafeZones(!p.safeZones)} testId="stage-safe">{strings.stage.safeZones}</Btn>
      <Btn icon={Crosshair} reason={strings.stage.occupiedReason}>{strings.stage.occupied}</Btn>
      <Btn icon={Waypoints} reason={strings.stage.focusReason}>{strings.stage.focus}</Btn>
      <Btn icon={Keyboard} reason={strings.stage.promptsReason}>{strings.stage.prompts}</Btn>
      <ThemeControl />
      {!p.menuControls && <Btn icon={Languages} reason={strings.stage.localeReason}>{strings.stage.locale}</Btn>}
      {!p.menuControls && <Btn icon={Sparkles} reason={strings.stage.pseudoReason}>{strings.stage.pseudo}</Btn>}
    </>
  )
  return (
    <div className="stage-toolbar" role="toolbar" aria-label={strings.stage.toolbar} onKeyDown={(e) => e.key === 'Escape' && more && setMore(false)}>
      <div className="seg" role="group" aria-label={strings.stage.modeLabel}>
        <button type="button" className="btn btn-seg" aria-pressed={p.mode === 'inspect'} onClick={() => p.onMode('inspect')} title={strings.stage.inspectTip} data-testid="mode-inspect">
          <MousePointer2 size={14} aria-hidden="true" /> {p.compact ? <span className="sr-only">{strings.stage.inspect}</span> : strings.stage.inspect}
        </button>
        <button type="button" className="btn btn-seg" aria-pressed={p.mode === 'play'} onClick={() => p.onMode('play')} title={strings.stage.playTip} data-testid="mode-play">
          <Play size={14} aria-hidden="true" /> {p.compact ? <span className="sr-only">{strings.stage.play}</span> : strings.stage.play}
        </button>
      </div>
      {p.swfPicker}
      <label className="inline">
        <span className="sr-only">{strings.stage.aspect}</span>
        <select value={p.aspect} onChange={(e) => p.onAspect(e.target.value as AspectId)} aria-label={strings.stage.aspect} title={strings.stage.aspect} data-testid="aspect">
          {(Object.keys(ASPECTS) as AspectId[]).map((a) => <option key={a} value={a}>{strings.stage.aspectNames[a]}</option>)}
        </select>
      </label>
      <Btn icon={RefreshCw} label={strings.stage.reload} onClick={p.onReload} testId="stage-reload" />
      <Btn icon={PictureInPicture2} label={p.detached ? strings.stage.dock : strings.stage.popout} onClick={p.onPopout} testId="stage-popout" />
      {p.compact ? (
        <>
          <Btn icon={Ellipsis} label={strings.stage.more} pressed={more} onClick={() => setMore(!more)} testId="stage-more" />
          {more && <div className="stage-more" role="group" aria-label={strings.stage.more}>{secondary}</div>}
        </>
      ) : (
        secondary
      )}
    </div>
  )
}
