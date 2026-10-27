import { useState, type ReactNode } from 'react'
import { Crosshair, Ellipsis, Keyboard, Languages, MousePointer2, Palette, PictureInPicture2, Play, RefreshCw, ScanLine, Sparkles, Waypoints, ZoomIn, ZoomOut } from 'lucide-react'
import { themeModes } from '@inkwell-ui/spec'
import { ASPECTS, type AspectId } from '../../shared/preview'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { useActiveSwf } from '../hooks/useProject'
import { useLocale } from './locale'
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

/** A button that opens a small panel under it; the toolbar's two panels (preview settings, later tools) share it. With `text` the button shows it, otherwise it is icon-only. */
function Pop({ open, onToggle, icon, label, tip, testId, right, children, text }: { open: boolean; onToggle(): void; icon: typeof Palette; label: string; tip?: string; testId: string; right?: boolean; children: ReactNode; text?: string }) {
  return (
    <span className="stage-pop">
      <Btn icon={icon} label={text ? undefined : label} pressed={open} onClick={onToggle} testId={testId} {...(tip ? { title: tip } : {})}>{text}</Btn>
      {open && <div className={`stage-pop-panel${right ? ' right' : ''}`} role="group" aria-label={label}>{children}</div>}
    </span>
  )
}

/** "Nordic · Deutsch": the current theme and language, so the state stays visible while the settings sit in a panel. */
const previewSummary = (theme: string | undefined, language: string | undefined): string => [theme, language].filter(Boolean).join(' · ') || strings.stage.previewSettings

/**
 * The stage toolbar of UX 4.3. Controls whose feature arrives later (Occupied HUD, Focus Graph, Prompts) are shown DISABLED with a one-line reason, never hidden: in the
 * "..." panel. Wide layout: mode | view (SWF, aspect, zoom, safe zones, reload, pop out) | one Preview settings button (theme, language, UI scale, Pseudo-Loc) | later tools.
 * The compact layout keeps its single More panel with everything.
 */
export function StageToolbar(p: StageToolbarProps) {
  const [more, setMore] = useState(false)
  const [preview, setPreview] = useState(false)
  const [later, setLater] = useState(false)
  const swf = useActiveSwf()
  const { language } = useLocale()
  const modes = swf ? themeModes(swf.ir) : []
  const theme = modes.length >= 2 ? swf?.previewTheme ?? swf?.menu?.userDefaults?.theme ?? modes[0] : undefined
  const lang = p.menuControls ? language || strings.stage.localeSource : undefined
  const settings = (
    <>
      <ThemeControl />
      {p.menuControls}
      {!p.menuControls && <Btn icon={Languages} reason={strings.stage.localeReason}>{strings.stage.locale}</Btn>}
      {!p.menuControls && <Btn icon={Sparkles} reason={strings.stage.pseudoReason}>{strings.stage.pseudo}</Btn>}
    </>
  )
  const zoom = (
    <span className="zoom" role="group" aria-label={strings.stage.zoom}>
      <Btn icon={ZoomOut} label={strings.stage.zoomOut} onClick={() => p.onZoom(-1)} />
      <button type="button" className="btn btn-quiet zoom-value" onClick={p.onZoomReset} title={strings.stage.zoomReset} aria-label={strings.stage.zoomReset}>{Math.round(p.zoom * 100)}%</button>
      <Btn icon={ZoomIn} label={strings.stage.zoomIn} onClick={() => p.onZoom(1)} />
    </span>
  )
  const safe = <Btn icon={ScanLine} label={strings.stage.safeZones} pressed={p.safeZones} onClick={() => p.onSafeZones(!p.safeZones)} testId="stage-safe" />
  const unbuilt = (
    <>
      <Btn icon={Crosshair} reason={strings.stage.occupiedReason}>{strings.stage.occupied}</Btn>
      <Btn icon={Waypoints} reason={strings.stage.focusReason}>{strings.stage.focus}</Btn>
      <Btn icon={Keyboard} reason={strings.stage.promptsReason}>{strings.stage.prompts}</Btn>
    </>
  )
  const close = (): void => (setMore(false), setPreview(false), setLater(false))
  return (
    <div className="stage-toolbar" role="toolbar" aria-label={strings.stage.toolbar} onKeyDown={(e) => e.key === 'Escape' && (more || preview || later) && close()}>
      <div className="seg" role="group" aria-label={strings.stage.modeLabel}>
        <button type="button" className="btn btn-seg" aria-pressed={p.mode === 'inspect'} onClick={() => p.onMode('inspect')} title={strings.stage.inspectTip} data-testid="mode-inspect">
          <MousePointer2 size={14} aria-hidden="true" /> {p.compact ? <span className="sr-only">{strings.stage.inspect}</span> : strings.stage.inspect}
        </button>
        <button type="button" className="btn btn-seg" aria-pressed={p.mode === 'play'} onClick={() => p.onMode('play')} title={strings.stage.playTip} data-testid="mode-play">
          <Play size={14} aria-hidden="true" /> {p.compact ? <span className="sr-only">{strings.stage.play}</span> : strings.stage.play}
        </button>
      </div>
      {!p.compact && <span className="stage-sep" aria-hidden="true" />}
      {p.swfPicker}
      <label className="inline">
        <span className="sr-only">{strings.stage.aspect}</span>
        <select value={p.aspect} onChange={(e) => p.onAspect(e.target.value as AspectId)} aria-label={strings.stage.aspect} title={strings.stage.aspect} data-testid="aspect">
          {(Object.keys(ASPECTS) as AspectId[]).map((a) => <option key={a} value={a}>{strings.stage.aspectNames[a]}</option>)}
        </select>
      </label>
      {!p.compact && zoom}
      {!p.compact && safe}
      <Btn icon={RefreshCw} label={strings.stage.reload} onClick={p.onReload} testId="stage-reload" />
      <Btn icon={PictureInPicture2} label={p.detached ? strings.stage.dock : strings.stage.popout} onClick={p.onPopout} testId="stage-popout" />
      {p.compact ? (
        <>
          <Btn icon={Ellipsis} label={strings.stage.more} pressed={more} onClick={() => setMore(!more)} testId="stage-more" />
          {more && <div className="stage-more" role="group" aria-label={strings.stage.more}>{settings}{zoom}{safe}{unbuilt}</div>}
        </>
      ) : (
        <>
          <span className="stage-sep" aria-hidden="true" />
          <Pop open={preview} onToggle={() => (setLater(false), setPreview(!preview))} icon={Palette} label={strings.stage.previewSettings} tip={strings.stage.previewSettingsTip} testId="stage-preview" text={previewSummary(theme, lang)}>
            {settings}
          </Pop>
          <span className="stage-spacer" />
          <Pop open={later} onToggle={() => (setPreview(false), setLater(!later))} icon={Ellipsis} label={strings.stage.moreTools} testId="stage-later" right>
            {unbuilt}
          </Pop>
        </>
      )}
    </div>
  )
}
