import type { ReactNode } from 'react'
import { ASPECTS, type AspectId } from '../../shared/preview'
import { strings } from '../strings'

/** Props of PreviewToolbar. All state lives in the parent. */
export interface PreviewToolbarProps {
  aspect: AspectId
  onAspect(a: AspectId): void
  safeZones: boolean
  onSafeZones(on: boolean): void
  onReload(): void
  /** Optional extra controls (e.g. a SWF picker) shown first. */
  children?: ReactNode
}

export function PreviewToolbar({ aspect, onAspect, safeZones, onSafeZones, onReload, children }: PreviewToolbarProps) {
  return (
    <div className="preview-toolbar" role="toolbar" aria-label={strings.panelPreview}>
      {children}
      <label>
        {strings.previewAspect}{' '}
        <select value={aspect} onChange={(e) => onAspect(e.target.value as AspectId)}>
          {(Object.keys(ASPECTS) as AspectId[]).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>
      <label>
        <input type="checkbox" checked={safeZones} onChange={(e) => onSafeZones(e.target.checked)} /> {strings.previewSafeZones}
      </label>
      <button onClick={onReload}>{strings.previewReload}</button>
    </div>
  )
}
