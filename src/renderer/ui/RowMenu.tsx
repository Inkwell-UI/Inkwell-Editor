import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { Btn } from './Btn'
import { Popover } from './Popover'

export interface RowMenuItem {
  label: string
  onClick(): void
  danger?: boolean
}

/** The "..." button of a list row: its less common actions in a small menu that closes after a choice. */
export function RowMenu({ label, items, testId, icon = MoreHorizontal }: { label: string; items: readonly RowMenuItem[]; testId?: string; icon?: LucideIcon }) {
  return (
    <Popover label={label} align="end" trigger={(p) => <Btn icon={icon} label={label} variant="quiet" expanded={p['aria-expanded']} haspopup="dialog" onClick={p.onClick} {...(testId ? { testId } : {})} />}>
      {(close) => (
        <ul className="row-menu" role="menu">
          {items.map((i) => (
            <li key={i.label}><button type="button" role="menuitem" className={`row-menu-item${i.danger ? ' is-danger' : ''}`} onClick={() => (close(), i.onClick())}>{i.label}</button></li>
          ))}
        </ul>
      )}
    </Popover>
  )
}
