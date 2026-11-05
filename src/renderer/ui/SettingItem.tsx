import { ChevronDown, ChevronRight, Loader, Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { strings } from '../../shared/strings'

export type ItemTone = 'ok' | 'warn' | 'error' | 'busy' | 'none'

interface Props {
  name: string
  /** One line of the current value or state, shown dim and cut off with an ellipsis. */
  value?: ReactNode
  tone?: ItemTone
  /** Whether the body is open until the user toggles it (a problem opens by itself). */
  autoOpen?: boolean
  /** The status in words, for screen readers (the dot is only colour). */
  statusLabel?: string
  /** The value is a file path: cut at the start so the folder name at the end stays. */
  path?: boolean
  /** The row edits something: a "Change" / "Close" label instead of a bare chevron. */
  editable?: boolean
  testId?: string
  /** Extra attributes on the root (for example `data-status`). */
  rootProps?: Record<string, string | boolean | undefined>
  children?: ReactNode
}

/** One setting or check: a line (status dot, name, value) that opens to its detail. Passing rows stay one line; a problem opens itself. */
export function SettingItem({ name, value, tone = 'none', statusLabel, path, editable, autoOpen = false, testId, rootProps, children }: Props) {
  const [userOpen, setUserOpen] = useState<boolean>()
  const open = userOpen ?? autoOpen
  return (
    <div className={'setting-item'} data-testid={testId} {...rootProps}>
      <button type="button" className="item-line" aria-expanded={open} onClick={() => setUserOpen(!open)}>
        {tone === 'busy' ? <Loader size={12} className="spin" aria-hidden="true" /> : <span className={`dot${tone === 'none' ? '' : ` dot-${tone}`}`} aria-hidden="true" />}
        <span className="item-name">{name}{statusLabel && <span className="sr-only">: {statusLabel}</span>}</span>
        <span className={`item-value${path ? ' item-value-path' : ''}`}>{path && typeof value === 'string' ? <bdi>{value}</bdi> : value}</span>
        {editable ? (
          <span className="item-act">{open ? strings.settings.close : <><Pencil size={12} aria-hidden="true" />{strings.settings.change}</>}</span>
        ) : open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      </button>
      {open && <div className="item-body">{children}</div>}
    </div>
  )
}
