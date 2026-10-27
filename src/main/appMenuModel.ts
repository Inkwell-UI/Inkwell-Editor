import type { MenuItemConstructorOptions } from 'electron'
import type { AppMenuItem } from '../shared/appMenu'

/** A menu role the title bar can run itself (the native menu runs roles for the focused window; a drawn menu has to call them). */
export interface RoleEntry {
  label: string
  key?: string
  run: () => void
}

/**
 * The application menu template as data for the title bar. Every entry that does something registers its handler in `actions` under its id (the template path, `0.2`,
 * `0.2.1` for a submenu entry), which `invokeAppMenu` runs; roles use `roles`, everything else its `click`. Accelerators are shown as `Ctrl+...`.
 */
export function appMenuModel(items: readonly MenuItemConstructorOptions[], path: string, roles: Readonly<Record<string, RoleEntry>>, actions: Map<string, () => void>): AppMenuItem[] {
  return items.map((it, i): AppMenuItem => {
    const id = `${path}${i}`
    if (it.type === 'separator') return { id, label: '', separator: true }
    const role = it.role ? roles[it.role] : undefined
    const click = it.click as (() => void) | undefined
    const action = role?.run ?? (click ? () => click() : undefined)
    if (action) actions.set(id, action)
    const accelerator = (typeof it.accelerator === 'string' ? it.accelerator.replace('CmdOrCtrl', 'Ctrl') : undefined) ?? role?.key
    return {
      id,
      label: it.label ?? role?.label ?? '',
      enabled: it.enabled !== false,
      ...(accelerator ? { accelerator } : {}),
      ...(it.sublabel ? { sublabel: it.sublabel } : {}),
      ...(Array.isArray(it.submenu) ? { submenu: appMenuModel(it.submenu, `${id}.`, roles, actions) } : {})
    }
  })
}
