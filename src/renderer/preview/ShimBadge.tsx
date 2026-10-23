import type { PreviewNotes } from '../../shared/preview'
import { strings } from '../strings'

/** Props of ShimBadge. */
export interface ShimBadgeProps {
  /** What this build's preview does not represent; omit for the generic notice only. */
  notes?: PreviewNotes
}

/** Info-level notice: this is Ruffle (Flash), not Scaleform GFx, and what it therefore leaves out. */
export function ShimBadge({ notes }: ShimBadgeProps) {
  return (
    <details className="shim-badge" role="note">
      <summary>
        <span className="badge-info">info</span> {strings.badgeTitle}
      </summary>
      <p>{strings.badgeBody}</p>
      <ul>
        {notes && notes.textNodes > 0 && <li>{strings.badgeFonts(notes.textNodes)}</li>}
        {notes && notes.textExtensions > 0 && <li>{strings.badgeTextExt(notes.textExtensions)}</li>}
        <li>{strings.badgeFilters}</li>
      </ul>
    </details>
  )
}
