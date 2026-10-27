import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AppMenu, AppMenuItem } from '../../shared/appMenu'
import { inkwell } from '../hooks/api'
import { useProject } from '../hooks/useProject'
import { strings } from '../strings'
import { Popover } from '../ui/Popover'

/** One menu entry; an entry with a submenu (Open Recent) expands in place. */
function Entry({ item, close }: { item: AppMenuItem; close: () => void }) {
  const [open, setOpen] = useState(false)
  if (item.separator) return <li role="separator" className="menu-sep" />
  const sub = item.submenu
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        className="menu-entry"
        disabled={item.enabled === false}
        aria-expanded={sub ? open : undefined}
        onClick={() => (sub ? setOpen(!open) : (close(), void inkwell?.invokeAppMenu(item.id)))}
      >
        <span className="menu-entry-label">{item.label}{item.sublabel && <span className="dim"> {item.sublabel}</span>}</span>
        {item.accelerator && <kbd>{item.accelerator}</kbd>}
        {sub && <ChevronRight size={12} aria-hidden="true" className={open ? 'flip-down' : undefined} />}
      </button>
      {sub && open && (
        <ul className="menu menu-nested" role="menu">
          {sub.map((s) => <Entry key={s.id} item={s} close={close} />)}
        </ul>
      )}
    </li>
  )
}

/**
 * The window's title bar (the main window has no native frame: `titleBarStyle: 'hidden'`, Windows draws min/max/close over its right end). Left the application menus,
 * drawn from the model main sends (`shared/appMenu.ts`; the entries run main's handlers by id), then the project title. The empty parts drag the window.
 */
export function TitleBar() {
  const project = useProject()
  const [menu, setMenu] = useState<AppMenu>([])
  useEffect(() => {
    void inkwell?.getAppMenu().then(setMenu)
    return inkwell?.onAppMenuChanged(setMenu)
  }, [])
  return (
    <div className="titlebar" role="banner">
      <nav className="titlebar-menus" aria-label={strings.menu.label}>
        {menu.map((top) => (
          <Popover
            key={top.id}
            label={top.label}
            trigger={(p, open) => <button type="button" className="btn btn-quiet titlebar-menu" {...p} aria-haspopup="menu" aria-pressed={open}>{top.label}</button>}
          >
            {(close) => (
              <ul className="menu titlebar-list" role="menu" aria-label={top.label}>
                {(top.submenu ?? []).map((it) => <Entry key={it.id} item={it} close={close} />)}
              </ul>
            )}
          </Popover>
        ))}
      </nav>
      <span className="titlebar-title">{strings.windowTitleFor(project?.name)}</span>
    </div>
  )
}
