import { useEffect, useMemo, useState } from 'react'
import { useActiveSwf, useProject } from '../hooks/useProject'
import { redoSwf, undoSwf } from '../state/overlayStore'
import { useProjectStore } from '../state/projectStore'
import { isPreviewWindow, usePopoutStore } from '../state/popoutStore'
import { useSelectionStore } from '../state/selectionStore'
import { useTraceStore } from '../state/traceStore'
import { runtimeRowId } from '../model/layerTree'
import { useWorkspaceStore } from '../state/workspaceStore'
import { strings } from '../../shared/strings'
import { Workspace } from '../workspace/Workspace'
import { applyOverrides, removePanel } from '../workspace/layout'
import { WORKSPACE_IDS, WORKSPACES } from '../workspace/workspaces'
import { inkwell } from '../hooks/api'
import { useDialogStore } from '../state/dialogStore'
import { flushGraphSaves } from '../state/graphStore'
import { PackManager } from '../packs/PacksSection'
import { Toasts } from '../ui/Toasts'
import { Dialogs } from './Dialogs'
import { DockStrip } from './DockStrip'
import { SettingsView } from './SettingsView'
import { FirstRunWizard } from './FirstRunWizard'
import { StartScreen } from './StartScreen'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'
import { TopBar } from './TopBar'

const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** What a folded dock shows at the right of its tab strip, by a panel id in the group. */
const STRIP_EXTRAS = { trace: DockStrip }

/** The active workspace's layout (data) with the user's sizes and tabs applied, and the preview removed while it is popped out (UX 2.3). */
function WorkspaceView() {
  const active = useWorkspaceStore((s) => s.active)
  const sizes = useWorkspaceStore((s) => s.sizes[active])
  const tabs = useWorkspaceStore((s) => s.tabs[active])
  const folds = useWorkspaceStore((s) => s.folds)
  const detached = usePopoutStore((s) => s.detached)
  const graphFull = useWorkspaceStore((s) => s.graphFull)
  const layout = useMemo(() => {
    const base = detached ? (removePanel(WORKSPACES[active].layout, 'preview') ?? WORKSPACES[active].layout) : WORKSPACES[active].layout
    return applyOverrides(base, { sizes, tabs, folds })
  }, [active, sizes, tabs, folds, detached])
  return <Workspace layout={layout} onResize={(k, s) => useWorkspaceStore.getState().setSizes(k, s)} onTab={(k, p) => useWorkspaceStore.getState().setTab(k, p)} onFold={(k, f) => useWorkspaceStore.getState().setFold(k, f)} stripExtras={STRIP_EXTRAS} overlayEdges={graphFull && active === 'behaviour'} />
}

/**
 * The window: start screen without a project, otherwise top bar (Zone 1), the workspace (Zones 2-6A) and the status bar (6B).
 * Global keys: Ctrl+1/2/3 switch workspace; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo the active SWF's overlay (not while typing in a field,
 * which has its own undo).
 */
export function AppShell() {
  const project = useProject()
  const swf = useActiveSwf()
  const open = useDialogStore((s) => s.open)
  const settingsOpen = open === 'settings'
  const projectSettingsOpen = open === 'projectSettings' && !!project

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

  // Enter toggles the fullscreen graph (Behaviour, not while typing or on a focused control that Enter activates)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ws = useWorkspaceStore.getState()
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented || ws.active !== 'behaviour' || useDialogStore.getState().open || isTyping(e.target)) return
      if (e.key === 'Enter' && !(e.target instanceof HTMLElement && e.target.closest('button, a, summary, [role="menuitem"], [role="option"], [role="tab"]'))) (e.preventDefault(), ws.setGraphFull(!ws.graphFull))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // first launch: the setup wizard shows once (main marks it as seen)
  const [wizard, setWizard] = useState(false)
  useEffect(() => {
    if (isPreviewWindow()) return
    void inkwell?.doctorFirstLaunch().then(setWizard)
  }, [])

  // Edit > Settings in the application menu
  useEffect(() => inkwell?.onOpenSettings(() => useDialogStore.getState().show('settings')), [])
  // View > Setup Guide: the first-run wizard again, with or without a project
  useEffect(() => inkwell?.onOpenSetup(() => setWizard(true)), [])
  // Edit > Project Settings (no project open: nothing to show)
  useEffect(() => inkwell?.onOpenProjectSettings(() => useDialogStore.getState().show('projectSettings')), [])
  // View > Package Manager (no project open: nothing to show)
  useEffect(() => inkwell?.onOpenPackages(() => useDialogStore.getState().show('packages')), [])
  // Edit > Undo / Redo of the title bar menu: a field being edited keeps its own undo, anything else is the active SWF's history
  useEffect(() => {
    const run = (name: 'undo' | 'redo'): void => {
      const id = useProjectStore.getState().activeSwfId
      if (isTyping(document.activeElement) || !id) document.execCommand(name)
      else (name === 'undo' ? undoSwf : redoSwf)(id)
    }
    const offs = [inkwell?.onUndo(() => run('undo')), inkwell?.onRedo(() => run('redo'))]
    return () => offs.forEach((f) => f?.())
  }, [])
  // File > Save: only graph edits are debounced; everything else is written as it changes
  useEffect(() => inkwell?.onSaveNow(flushGraphSaves), [])

  // a selection whose node vanished (IR changed, other SWF) is dropped
  useEffect(() => {
    useSelectionStore.getState().prune((id) => !!swf?.ir.nodes[id] || useTraceStore.getState().spawned.some((s) => runtimeRowId(s.path) === id)) // a component instance a graph made is not an IR node
  }, [swf])

  if (project === undefined) return <><TitleBar /><div className="loading" role="status">{strings.loading}</div></>
  if (project === null)
    return (
      <>
        <TitleBar />
        {settingsOpen ? <SettingsView /> : wizard ? <FirstRunWizard onDone={() => setWizard(false)} /> : <StartScreen />}
        <Dialogs />
        <Toasts />
      </>
    )
  const setupView = wizard && !settingsOpen && !projectSettingsOpen // the setup guide is a view of its own: no top bar, no status bar
  return (
    <div className="shell">
      <TitleBar />
      {!setupView && <TopBar />}
      <main className="shell-main">{settingsOpen ? <SettingsView key="settings" /> : wizard ? <FirstRunWizard onDone={() => setWizard(false)} /> : projectSettingsOpen ? <SettingsView key="project" initial="project" /> : <WorkspaceView />}</main>
      {!setupView && <StatusBar />}
      {open === 'packages' && <PackManager onClose={() => useDialogStore.getState().close()} />}
      <Dialogs />
      <Toasts />
    </div>
  )
}
