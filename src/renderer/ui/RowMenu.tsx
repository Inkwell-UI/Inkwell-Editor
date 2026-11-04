import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { Btn } from './Btn'
import { Popover } from './Popover'

export interface RowMenuItem {
  label: string
  onClick(): void
  danger?: boolean
  /** Why the item cannot run now: it stays in the menu, dimmed, with this as its tooltip. */
  disabled?: string
  /** Hotkey shown at the right, `Ctrl+D`. */
  keys?: string
}

function Items({ items, close }: { items: readonly RowMenuItem[]; close(): void }) {
  return (
    <ul className="row-menu" role="menu">
      {items.map((i) => (
        <li key={i.label}><button type="button" role="menuitem" className={`row-menu-item${i.danger ? ' is-danger' : ''}`} disabled={!!i.disabled} title={i.disabled} onClick={() => (close(), i.onClick())}>{i.label}{i.keys && <kbd>{i.keys}</kbd>}</button></li>
      ))}
    </ul>
  )
}

/** The same menu opened at the pointer by a right-click: hold `at` in state (set it from `onContextMenu`, after `preventDefault`) and clear it in `onClose`. */
export function RowContextMenu({ label, items, at, onClose }: { label: string; items: readonly RowMenuItem[]; at: { x: number; y: number }; onClose(): void }) {
  return <Popover label={label} className="row-menu-pop" anchor={at} onClose={onClose} trigger={() => null}>{(close) => <Items items={items} close={close} />}</Popover>
}

/** The "..." button of a list row: its less common actions in a small menu that closes after a choice. */
export function RowMenu({ label, items, testId, icon = MoreHorizontal }: { label: string; items: readonly RowMenuItem[]; testId?: string; icon?: LucideIcon }) {
  return (
    <Popover label={label} align="end" className="row-menu-pop" trigger={(p) => <Btn icon={icon} label={label} variant="quiet" expanded={p['aria-expanded']} haspopup="dialog" onClick={p.onClick} {...(testId ? { testId } : {})} />}>
      {(close) => <Items items={items} close={close} />}
    </Popover>
  )
}
