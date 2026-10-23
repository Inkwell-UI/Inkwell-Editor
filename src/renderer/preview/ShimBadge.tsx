import { Info } from 'lucide-react'
import type { PreviewNotes } from '../../shared/preview'
import { strings } from '../strings'

/** Props of ShimBadge. */
export interface ShimBadgeProps {
  /** What this build's preview does not represent; omit for the generic notice only. */
  notes?: PreviewNotes
}

/** The persistent GFx approximation note: this is Ruffle (Flash), not Scaleform GFx; lists the active shims and what the preview leaves out. */
export function ShimBadge({ notes }: ShimBadgeProps) {
  return (
    <details className="shim-badge" role="note">
      <summary>
        <Info size={13} aria-hidden="true" /> {strings.badgeTitle} <span className="dim">{strings.badgeShimsShort}</span>
      </summary>
      <p>{strings.badgeBody}</p>
      <ul>
        {notes && notes.textNodes > 0 && <li>{strings.badgeFonts(notes.textNodes, notes.approximated)}</li>}
        {notes && notes.textExtensions > 0 && <li>{strings.badgeTextExt(notes.textExtensions)}</li>}
        {notes?.ddsImages ? <li>{strings.badgeDds(notes.ddsImages)}</li> : null}
        <li>{strings.badgeFilters}</li>
      </ul>
      <p>{strings.badgeShimsTitle}</p>
      <ul>
        {strings.badgeShims.map((s) => <li key={s}>{s}</li>)}
      </ul>
    </details>
  )
}
