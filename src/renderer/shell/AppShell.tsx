import { useEffect, useMemo } from 'react'
import { useActiveSwf, useProject } from '../hooks/useProject'
import { redoSwf, undoSwf } from '../state/overlayStore'
import { useProjectStore } from '../state/projectStore'
import { isPreviewWindow, usePopoutStore } from '../state/popoutStore'
import { useSelectionStore } from '../state/selectionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { strings } from '../strings'
import { Workspace } from '../workspace/Workspace'
import { applyOverrides, removePanel } from '../workspace/layout'
import { WORKSPACE_IDS, WORKSPACES } from '../workspace/workspaces'
import { inkwell } from '../hooks/api'
import { useDialogStore } from '../state/dialogStore'
import { Toasts } from '../ui/Toasts'
import { Dialogs } from './Dialogs'
import { SettingsView } from './SettingsView'
import { StartScreen } from './StartScreen'
import { StatusBar } from './StatusBar'
import { TopBar } from './TopBar'

const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** The active workspace's layout (data) with the user's sizes and tabs applied, and the preview removed while it is popped out (UX 2.3). */
function WorkspaceView() {
  const active = useWorkspaceStore((s) => s.active)
  const sizes = useWorkspaceStore((s) => s.sizes[active])
  const tabs = useWorkspaceStore((s) => s.tabs[active])
  const detached = usePopoutStore((s) => s.detached)
  const layout = useMemo(() => {
    const base = detached ? (removePanel(WORKSPACES[active].layout, 'preview') ?? WORKSPACES[active].layout) : WORKSPACES[active].layout
    return applyOverrides(base, { sizes, tabs })
  }, [active, sizes, tabs, detached])
  return <Workspace layout={layout} onResize={(k, s) => useWorkspaceStore.getState().setSizes(k, s)} onTab={(k, p) => useWorkspaceStore.getState().setTab(k, p)} />
}

/**
 * The window: start screen without a project, otherwise top bar (Zone 1), the workspace (Zones 2-6A) and the status bar (6B).
 * Global keys: Ctrl+1/2/3 switch workspace; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo the active SWF's overlay (not while typing in a field,
 * which has its own undo).
 */
export function AppShell() {
  const project = useProject()
  const swf = useActiveSwf()
  const settingsOpen = useDialogStore((s) => s.open) === 'settings'

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const i = ['1', '2', '3'].indexOf(e.key)
      if (i >= 0) {
        e.preventDefault()
        useWorkspaceStore.getState().setActive(WORKSPACE_IDS[i]!)
        return
      }
      const id = useProjectStore.getState().activeSwfId
      if (!id || isTyping(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) (e.preventDefault(), undoSwf(id))
      else if ((k === 'z' && e.shiftKey) || k === 'y') (e.preventDefault(), redoSwf(id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // first launch: the Setup Doctor opens by itself when a check fails (main marks it as seen either way)
  useEffect(() => {
    if (isPreviewWindow()) return
    void inkwell?.doctorFirstLaunch().then((show) => show && useDialogStore.getState().show('settings'))
  }, [])

  // Edit > Settings in the application menu
  useEffect(() => inkwell?.onOpenSettings(() => useDialogStore.getState().show('settings')), [])

  // a selection whose node vanished (IR changed, other SWF) is dropped
  useEffect(() => {
    useSelectionStore.getState().prune((id) => !!swf?.ir.nodes[id])
  }, [swf])

  if (project === undefined) return <div className="loading" role="status">{strings.loading}</div>
  if (project === null)
    return (
      <>
        {settingsOpen ? <SettingsView /> : <StartScreen />}
        <Dialogs />
        <Toasts />
      </>
    )
  return (
    <div className="shell">
      <TopBar />
      <main className="shell-main">{settingsOpen ? <SettingsView /> : <WorkspaceView />}</main>
      <StatusBar />
      <Dialogs />
      <Toasts />
    </div>
  )
}
