import { useRef } from 'react'
import { Crosshair, Frame, Grid2x2, Grid3x3, Ruler, ScanLine, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useElementSize } from '../hooks/useElementSize'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Popover } from '../ui/Popover'
import { safeRects, type Size } from './geometry'

// Preview settings: overlays and a background that exist in the editor's preview only. Nothing here reaches a build, a deploy or the project.

export type OverlayId = 'thirds' | 'grid' | 'center' | 'safe' | 'margins' | 'rulers'
export type BackgroundMode = 'none' | 'color' | 'image'

export interface PreviewSettings {
  overlays: Record<OverlayId, boolean>
  /** Margins overlay inset, in pixels of the SWF's stage. */
  marginPx: number
  background: BackgroundMode
  color: string
  /** An object URL of the chosen file; the parent revokes it when it is replaced. */
  image?: string
  imageName?: string
  /** Brightness of the background image: 1 as it is, 0 fully dimmed. */
  brightness: number
}

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  overlays: { thirds: false, grid: false, center: false, safe: true, margins: false, rulers: false },
  marginPx: 48,
  background: 'none',
  color: '#2b3a4a',
  brightness: 1
}

const OVERLAYS: readonly { id: OverlayId; icon: LucideIcon }[] = [
  { id: 'thirds', icon: Grid3x3 },
  { id: 'grid', icon: Grid2x2 },
  { id: 'center', icon: Crosshair },
  { id: 'safe', icon: ScanLine },
  { id: 'margins', icon: Frame },
  { id: 'rulers', icon: Ruler }
]
const PRESETS = ['#000000', '#808080', '#2b3a4a'] as const
const HEX = /^#[0-9a-f]{6}$/i
const MARGIN_MAX = 500

/** True when a background shows (it needs the movie drawn without its own stage color). */
export const hasBackground = (s: PreviewSettings): boolean => s.background === 'color' || (s.background === 'image' && !!s.image)

const activeCount = (s: PreviewSettings): number => Object.values(s.overlays).filter(Boolean).length + (hasBackground(s) ? 1 : 0)

/** The icon-only toolbar button and its popout. The dot on the button says something is on. */
export function PreviewSettingsControl({ value, onChange }: { value: PreviewSettings; onChange(next: PreviewSettings): void }) {
  const n = activeCount(value)
  const file = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<PreviewSettings>): void => onChange({ ...value, ...patch })
  const pickImage = (f: File | undefined): void => {
    if (!f) return
    if (value.image) URL.revokeObjectURL(value.image)
    set({ image: URL.createObjectURL(f), imageName: f.name, background: 'image' })
  }
  return (
    <Popover
      label={strings.stage.previewSettings}
      align="end"
      className="pv-settings-pop"
      trigger={(p) => (
        <button type="button" className="btn btn-icon" {...p} title={strings.stage.previewSettings} aria-label={n > 0 ? strings.stage.previewOn(n) : strings.stage.previewSettings} data-testid="stage-preview-settings">
          <SlidersHorizontal size={14} aria-hidden="true" />
        </button>
      )}
    >
      <div className="pv-settings">
        <section>
          <h3 className="pv-settings-head">{strings.stage.previewOverlays}</h3>
          <div className="pv-settings-grid">
            {OVERLAYS.map(({ id, icon }) => (
              <Btn key={id} icon={icon} pressed={value.overlays[id]} variant="quiet" className="pv-overlay-btn" testId={`overlay-${id}`} onClick={() => set({ overlays: { ...value.overlays, [id]: !value.overlays[id] } })}>
                {strings.stage.overlayNames[id]}
              </Btn>
            ))}
          </div>
          {value.overlays.margins && (
            <label className="pv-settings-row">
              <span>{strings.stage.overlayNames.margins}</span>
              <span className="pv-unit">
                <input type="number" min={0} max={MARGIN_MAX} value={value.marginPx} aria-label={strings.stage.marginPx} data-testid="margin-px"
                  onChange={(e) => e.target.value !== '' && set({ marginPx: Math.min(MARGIN_MAX, Math.max(0, Math.round(Number(e.target.value)))) })} />
                <span>px</span>
              </span>
            </label>
          )}
        </section>
        <section>
          <h3 className="pv-settings-head">{strings.stage.background}</h3>
          <span className="seg" role="group" aria-label={strings.stage.background}>
            {([['none', strings.stage.backgroundNone], ['color', strings.stage.backgroundColor], ['image', strings.stage.backgroundImage]] as const).map(([m, text]) => (
              <Btn key={m} pressed={value.background === m} className="btn-seg" testId={`bg-${m}`} onClick={() => set({ background: m })}>{text}</Btn>
            ))}
          </span>
          {value.background === 'color' && (
            <div className="pv-settings-row">
              <span className="pv-hex">
                <span className="pv-swatch" style={{ background: value.color }} aria-hidden="true" />
                <input type="text" value={value.color} maxLength={7} spellCheck={false} aria-label={strings.stage.backgroundHex} data-testid="bg-hex"
                  onChange={(e) => set({ color: e.target.value })} onBlur={() => HEX.test(value.color) || set({ color: DEFAULT_PREVIEW_SETTINGS.color })} />
              </span>
              <span className="pv-presets" role="group" aria-label={strings.stage.backgroundPresets}>
                {PRESETS.map((c) => <button key={c} type="button" className="pv-swatch pv-preset" style={{ background: c }} title={c} aria-label={c} onClick={() => set({ color: c })} />)}
              </span>
            </div>
          )}
          {value.background === 'image' && (
            <div className="pv-settings-row">
              <span className="pv-hex"><span className="pv-file">{value.imageName ?? ''}</span></span>
              <Btn onClick={() => file.current?.click()} testId="bg-choose">{strings.stage.backgroundChoose}</Btn>
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => (pickImage(e.target.files?.[0]), (e.target.value = ''))} />
            </div>
          )}
          {value.background === 'image' && (
            <label className="pv-settings-row">
              <span>{strings.stage.backgroundBrightness}</span>
              <input type="range" className="pv-dim-input" min={0} max={1} step={0.05} value={value.brightness} aria-label={strings.stage.backgroundBrightness} data-testid="bg-brightness"
                onChange={(e) => e.target.value !== '' && set({ brightness: Math.min(1, Math.max(0, Number(e.target.value))) })} />
              <output className="pv-dim-value">{Math.round(value.brightness * 100)}%</output>
            </label>
          )}
          <p className="pv-settings-hint">{strings.stage.previewOnly}</p>
        </section>
      </div>
    </Popover>
  )
}

/** The picked background, behind the movie (which is drawn transparent while this shows). */
export function PreviewBackgroundLayer({ settings }: { settings: PreviewSettings }) {
  if (!hasBackground(settings)) return null
  const style = settings.background === 'image' ? { backgroundImage: `url("${settings.image}")`, filter: `brightness(${settings.brightness})` } : { background: HEX.test(settings.color) ? settings.color : DEFAULT_PREVIEW_SETTINGS.color }
  return <div className="pv-background" style={style} aria-hidden="true" />
}

const line = (cls: string, style: React.CSSProperties) => <div className={`pv-line ${cls}`} style={style} />

/** The overlays over the screen box (its relatively positioned parent). `stage` is the SWF's design size, for the pixel overlays. Ignores the mouse. */
export function PreviewOverlays({ settings, stage }: { settings: PreviewSettings; stage: Size }) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const o = settings.overlays
  const ready = size.width > 0 && stage.width > 0 && stage.height > 0
  const sx = size.width / stage.width
  const sy = size.height / stage.height
  const safe = safeRects(size)
  const m = Math.min(settings.marginPx, stage.width / 2, stage.height / 2)
  const rect = (r: { x: number; y: number; width: number; height: number }, cls: string, label: string) => (
    <div className={`safe-rect ${cls}`} style={{ left: r.x, top: r.y, width: r.width, height: r.height }}><span>{label}</span></div>
  )
  const ticks = (len: number, step: number, vertical: boolean) =>
    Array.from({ length: Math.ceil(len / step) }, (_, i) => i * step).map((v) => {
      const big = v % (step * 5) === 0
      const pos = vertical ? v * sy : v * sx
      return (
        <div key={`${vertical}${v}`}>
          {line('pv-tick', vertical ? { top: pos, left: 0, width: big ? 10 : 5, height: 1 } : { left: pos, top: 0, height: big ? 10 : 5, width: 1 })}
          {big && v > 0 && <span className="pv-ruler-label" style={vertical ? { top: pos + 2, left: 12 } : { left: pos + 2, top: 12 }}>{v}</span>}
        </div>
      )
    })
  return (
    <div ref={ref} className="safe-overlay" aria-hidden="true">
      {ready && (
        <>
          {o.grid && Array.from({ length: 9 }, (_, i) => (i + 1) * 10).flatMap((p) => [line('pv-grid', { left: `${p}%`, top: 0, bottom: 0, width: 1 }), line('pv-grid', { top: `${p}%`, left: 0, right: 0, height: 1 })])}
          {o.thirds && [100 / 3, 200 / 3].flatMap((p) => [line('pv-thirds', { left: `${p}%`, top: 0, bottom: 0, width: 1 }), line('pv-thirds', { top: `${p}%`, left: 0, right: 0, height: 1 })])}
          {o.center && (
            <>
              {line('pv-center', { left: '50%', top: 'calc(50% - 10px)', width: 1, height: 20 })}
              {line('pv-center', { top: '50%', left: 'calc(50% - 10px)', height: 1, width: 20 })}
            </>
          )}
          {o.safe && (
            <>
              {rect(safe.action, 'safe-action', strings.previewSafeAction)}
              {rect(safe.title, 'safe-title', strings.previewSafeTitle)}
            </>
          )}
          {o.margins && rect({ x: m * sx, y: m * sy, width: size.width - 2 * m * sx, height: size.height - 2 * m * sy }, 'pv-margins', `${m} px`)}
          {o.rulers && (
            <>
              <div className="pv-ruler-strip" style={{ left: 0, right: 0, top: 0, height: 10 }} />
              <div className="pv-ruler-strip" style={{ left: 0, top: 0, bottom: 0, width: 10 }} />
              {ticks(stage.width, 100, false)}
              {ticks(stage.height, 100, true)}
            </>
          )}
        </>
      )}
    </div>
  )
}
