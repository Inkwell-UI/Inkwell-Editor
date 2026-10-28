import { useState, type ReactNode } from 'react'
import { Ellipsis, Languages, MousePointer2, MousePointerClick, Pause, PictureInPicture2, Play, RefreshCw, ScanLine, Waypoints, ZoomIn, ZoomOut } from 'lucide-react'
import { ASPECTS, type AspectId } from '../../shared/preview'
import { useElementSize } from '../hooks/useElementSize'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { LocaleControls } from './locale'
import { UiScaleButton } from './uiScale'
import { ThemeControl } from './ThemeControl'
import { PromptsControl } from './prompts'

export type StageMode = 'inspect' | 'play'

/** Props of StageToolbar. All state lives in the parent (PreviewPanel). */
export interface StageToolbarProps {
  mode: StageMode
  onMode(m: StageMode): void
  /** The movie is frozen (timers, tweens, timeline). */
  paused: boolean
  onPaused(paused: boolean): void
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
  /** A small slot (the fixed preview of the Behaviour mode): essentials (Interact, Pause, SWF, aspect, reload, pop out); zoom and the long toggles sit in a "More" popover. */
  compact: boolean
  /** SWF picker (the detached window has no top bar). */
  swfPicker?: ReactNode
  /** Custom menu only: shows the language and UI scale controls (they need the Inkwell Runtime). */
  menuControls?: boolean
  /** Custom menu only (W3/W4): the Focus Graph mode toggle; the Prompts preview toggle shows with it. Absent = both disabled with a reason. */
  focusGraph?: { on: boolean; onToggle(): void }
}

/** What a click on the stage does: inspect layers, play the menu, or edit the gamepad focus graph (which needs the inspect overlay, so it is a mode of its own). */
function ModeSwitch({ p, iconOnly }: { p: StageToolbarProps; iconOnly: boolean }) {
  const focus = p.focusGraph?.on === true
  const text = (s: string): string | undefined => (iconOnly ? undefined : s)
  const pick = (m: StageMode, f: boolean): void => {
    if (f !== focus) p.focusGraph?.onToggle()
    p.onMode(m)
  }
  return (
    <span className="seg" role="group" aria-label={strings.stage.modes}>
      <Btn icon={MousePointer2} label={strings.stage.inspectTip} pressed={p.mode === 'inspect' && !focus} onClick={() => pick('inspect', false)} testId="mode-inspect" className="btn-seg">{text(strings.stage.inspect)}</Btn>
      <Btn icon={MousePointerClick} label={strings.stage.interactTip} pressed={p.mode === 'play'} onClick={() => pick('play', false)} testId="mode-play" className="btn-seg">{text(strings.stage.interact)}</Btn>
      <Btn icon={Waypoints} label={strings.stage.focusTip} reason={p.focusGraph ? undefined : strings.stage.focusReason} pressed={focus} onClick={() => pick('inspect', true)} testId="stage-focus" className="btn-seg">{text(strings.stage.focus)}</Btn>
    </span>
  )
}

/**
 * The stage toolbar of UX 4.3. Wide layout: playback (Pause, Reload) | what a click does (Inspect, Interact, Focus) | the player (language, theme, input device) | the screen
 * (SWF, aspect, zoom, UI scale, safe zones, pop out). The compact layout keeps the essentials and puts the rest in one More panel.
 */
/** Below this width the toolbar keeps the essentials and puts the rest in its More panel (the preview panel's own compact layout does the same in a small slot). */
const TIGHT_BELOW = 1000

export function StageToolbar(p: StageToolbarProps) {
  const [more, setMore] = useState(false)
  const [ref, size] = useElementSize<HTMLDivElement>()
  const tight = p.compact || (size.width > 0 && size.width < TIGHT_BELOW)
  const player = (
    <>
      {p.menuControls ? <LocaleControls /> : <Btn icon={Languages} reason={strings.stage.localeReason}>{strings.stage.locale}</Btn>}
      <ThemeControl />
      {p.focusGraph && <PromptsControl />}
    </>
  )
  const uiScale = p.menuControls ? <UiScaleButton testId="stage-ui-scale" /> : undefined
  const zoom = (
    <span className="zoom" role="group" aria-label={strings.stage.zoom}>
      <Btn icon={ZoomOut} label={strings.stage.zoomOut} onClick={() => p.onZoom(-1)} />
      <button type="button" className="btn btn-quiet zoom-value" onClick={p.onZoomReset} title={strings.stage.zoomReset} aria-label={strings.stage.zoomReset}>{Math.round(p.zoom * 100)}%</button>
      <Btn icon={ZoomIn} label={strings.stage.zoomIn} onClick={() => p.onZoom(1)} />
    </span>
  )
  const safe = <Btn icon={ScanLine} label={strings.stage.safeZones} pressed={p.safeZones} onClick={() => p.onSafeZones(!p.safeZones)} testId="stage-safe" />
  const aspect = (
    <label className="inline">
      <span className="sr-only">{strings.stage.aspect}</span>
      <select value={p.aspect} onChange={(e) => p.onAspect(e.target.value as AspectId)} aria-label={strings.stage.aspect} title={strings.stage.aspect} data-testid="aspect">
        {(Object.keys(ASPECTS) as AspectId[]).map((a) => <option key={a} value={a}>{strings.stage.aspectNames[a]}</option>)}
      </select>
    </label>
  )
  const pause = <Btn icon={p.paused ? Play : Pause} label={p.paused ? strings.stage.resumeTip : strings.stage.pauseTip} pressed={p.paused} onClick={() => p.onPaused(!p.paused)} testId="stage-pause" className="icon-filled" />
  const reload = <Btn icon={RefreshCw} label={strings.stage.reload} onClick={p.onReload} testId="stage-reload" />
  const popout = <Btn icon={PictureInPicture2} label={p.detached ? strings.stage.dock : strings.stage.popout} onClick={p.onPopout} testId="stage-popout" />
  return (
    <div ref={ref} className={`stage-toolbar${tight ? ' is-tight' : ''}`} role="toolbar" aria-label={strings.stage.toolbar} onKeyDown={(e) => e.key === 'Escape' && more && setMore(false)}>
      {pause}
      {reload}
      {!tight && <span className="stage-sep" aria-hidden="true" />}
      <ModeSwitch p={p} iconOnly={tight} />
      {tight ? (
        <>
          {p.swfPicker}
          {aspect}
          {popout}
          <Btn icon={Ellipsis} label={strings.stage.more} pressed={more} onClick={() => setMore(!more)} testId="stage-more" />
          {more && (
            <div className="stage-more" role="group" aria-label={strings.stage.more}>
              <span className="stage-more-head">{strings.stage.groupPlayer}</span>
              {player}
              <span className="stage-more-head">{strings.stage.groupScreen}</span>
              {zoom}{uiScale}{safe}
            </div>
          )}
        </>
      ) : (
        <>
          <span className="stage-sep" aria-hidden="true" />
          {player}
          <span className="stage-spacer" />
          {p.swfPicker}
          {aspect}
          {zoom}
          {uiScale}
          {safe}
          {popout}
        </>
      )}
    </div>
  )
}
