import { strings } from './strings'

/**
 * The editor's commands as data: the command palette, the View/Help menus (main builds them from the entries with a `menu`), the title bar menu and the keyboard
 * shortcut dialog all read this list. What a command does is in the renderer (`state/runCommand.ts`). The palette adds the SWFs and graphs of the open project on top.
 */
export type CommandId =
  | 'palette' | 'save' | 'rebuild' | 'deploy' | 'devDeploy' | 'package' | 'packages' | 'setup' | 'settings' | 'projectSettings'
  | 'workspace1' | 'workspace2' | 'workspace3' | 'playPause' | 'reloadPreview' | 'shortcuts'

export interface CommandDef {
  id: CommandId
  label: string
  /** Shown as plain text, `Ctrl+K`; when `menu` is set, main also registers it as the menu accelerator (`Ctrl` -> `CmdOrCtrl`). */
  keys?: string
  /** The native/title bar menu main puts it in, built from this list. Commands without it are in the palette (and elsewhere in main's template) only. */
  menu?: 'view' | 'help'
  needsProject: boolean
}

const ws = strings.top.workspaceNames

export const COMMANDS: readonly CommandDef[] = [
  { id: 'palette', label: strings.cmd.palette, keys: 'Ctrl+K', menu: 'view', needsProject: false },
  { id: 'save', label: strings.cmd.save, keys: 'Ctrl+S', needsProject: true },
  { id: 'rebuild', label: strings.cmd.rebuild, keys: 'Ctrl+B', menu: 'view', needsProject: true },
  { id: 'deploy', label: strings.cmd.deploy, keys: 'Ctrl+Shift+B', menu: 'view', needsProject: true },
  { id: 'devDeploy', label: strings.cmd.devDeploy, needsProject: true },
  { id: 'package', label: strings.cmd.package, needsProject: true },
  { id: 'playPause', label: strings.cmd.playPause, keys: 'Ctrl+P', menu: 'view', needsProject: true },
  { id: 'reloadPreview', label: strings.cmd.reloadPreview, keys: 'Ctrl+R', menu: 'view', needsProject: true },
  { id: 'workspace1', label: strings.cmd.workspace(ws['layout']!), keys: 'Ctrl+1', needsProject: true },
  { id: 'workspace2', label: strings.cmd.workspace(ws['behaviour']!), keys: 'Ctrl+2', needsProject: true },
  { id: 'workspace3', label: strings.cmd.workspace(ws['localization']!), keys: 'Ctrl+3', needsProject: true },
  { id: 'packages', label: strings.cmd.packages, needsProject: true },
  { id: 'setup', label: strings.cmd.setup, needsProject: false },
  { id: 'settings', label: strings.cmd.settings, keys: 'Ctrl+,', needsProject: false },
  { id: 'projectSettings', label: strings.cmd.projectSettings, keys: 'Ctrl+Shift+,', needsProject: true },
  { id: 'shortcuts', label: strings.cmd.shortcuts, keys: 'F1', menu: 'help', needsProject: false }
]

/** Electron accelerator of a command shown in a menu. */
export const acceleratorOf = (c: CommandDef): string | undefined => c.keys?.replace(/^Ctrl/, 'CmdOrCtrl')

/** Rows `[label, keys]` of the application shortcuts, then the graph's, for the shortcut dialog. */
export function shortcutGroups(): { title: string; rows: [string, string][] }[] {
  const app = COMMANDS.filter((c) => c.keys).map((c): [string, string] => [c.label, c.keys!])
  return [
    { title: strings.shortcuts.app, rows: [...app, [strings.menu.undo, 'Ctrl+Z'], [strings.menu.redo, 'Ctrl+Y']] },
    { title: strings.shortcuts.graph, rows: strings.shortcuts.graphRows }
  ]
}
