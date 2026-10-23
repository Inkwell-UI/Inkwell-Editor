import { useElementSize } from '../hooks/useElementSize'
import { strings } from '../strings'
import { safeRects, type Rect } from './geometry'

/** Props of SafeZoneOverlay. */
export interface SafeZoneOverlayProps {
  /** Draw nothing when false (the toggle lives in the toolbar; this keeps the overlay a pure function of its props). */
  visible: boolean
}

/** Title-safe and action-safe outlines over its (relatively positioned) parent, which should be the screen box. Ignores the mouse. */
export function SafeZoneOverlay({ visible }: SafeZoneOverlayProps) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const r = safeRects(size)
  const box = (rect: Rect, cls: string, label: string) => (
    <div className={`safe-rect ${cls}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
      <span>{label}</span>
    </div>
  )
  return (
    <div ref={ref} className="safe-overlay" aria-hidden="true">
      {visible && size.width > 0 && (
        <>
          {box(r.action, 'safe-action', strings.previewSafeAction)}
          {box(r.title, 'safe-title', strings.previewSafeTitle)}
        </>
      )}
    </div>
  )
}
