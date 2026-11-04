import { reloadPacks } from '../hooks/usePacks'
import { inkwell } from '../hooks/api'
import { useProjectStore } from './projectStore'
import { setComponentGraph } from './componentGraphs'
import { openLayerGraph } from './graphDocs'
import { useGraphFollow } from './graphFollow'
import { setGraphEditListener, setGraphSaver } from './graphStore'
import { graphEdited } from './hotReload'
import { setOverlaySaver } from './overlayStore'
import { trackSave } from './saveState'
import { setMenuSaver } from './menuStore'
import { useSelectionStore } from './selectionStore'
import { useTimingStore } from './timingStore'
import { useSyncStore } from './syncStore'
import { usePopoutStore } from './popoutStore'
import { useDevStore } from './devStore'
import { useWorkspaceStore } from './workspaceStore'

/**
 * Connects the main process to the stores, once per window (main.tsx). Everything the renderer knows about the outside arrives here:
 * - sync state and project -> `syncStore`, `projectStore`; builds -> `timingStore` (history of the last 50).
 * - `onUiEvent`: the OTHER window's selection / active SWF (the detached preview and the main window stay in step).
 * - `onFigmaSelection`: the layers selected in Figma -> `selectionStore.applyFigmaSelection` (honours the "mirror" setting; may switch the active SWF).
 * - the other direction: local selection / active-SWF changes are sent as UI events; overlay edits are saved through `saveOverlay`.
 * Returns the cleanup function.
 */
export function startBridge(): () => void {
  if (!inkwell) {
    useProjectStore.getState().setProject(null) // plain browser (no Electron): the start screen
    return () => undefined
  }
  const api = inkwell
  const offs: (() => void)[] = []

  void api.getSync().then((s) => useSyncStore.getState().set(s))
  offs.push(api.onSync((s) => useSyncStore.getState().set(s)))
  void api.getProject().then((p) => useProjectStore.getState().setProject(p))
  offs.push(api.onProject((p) => useProjectStore.getState().setProject(p)))
  void api.getDevState().then((s) => useDevStore.getState().setState(s))
  offs.push(api.onDevState((s) => useDevStore.getState().setState(s)))
  offs.push(api.onDevEvents((e) => useDevStore.getState().apply(e)))
  offs.push(api.onPacksChanged(reloadPacks))
  // the game starts connecting: show Behaviour with the Runtime Trace on the game source
  offs.push(
    useDevStore.subscribe((s, prev) => {
      if (s.dev.phase !== 'connecting' || prev.dev.phase === 'connecting') return
      useWorkspaceStore.getState().setActive('behaviour')
      useWorkspaceStore.getState().showDockTab('trace')
      s.setSource('game')
    })
  )
  void api.getPreviewDetached().then((d) => usePopoutStore.getState().setDetached(d))
  offs.push(api.onPreviewDetached((d) => usePopoutStore.getState().setDetached(d)))

  // Build history: one record per finished build (`buildSeq`), the Ruffle time attached when it arrives.
  let lastSeq = -1
  offs.push(
    api.onSync((s) => {
      if (s.timing && s.buildSeq !== undefined && s.buildSeq !== lastSeq) {
        lastSeq = s.buildSeq
        useTimingStore.getState().record({ seq: s.buildSeq, swfName: s.timingSwf ?? '', stages: s.timing.stages, total: s.timing.total })
      }
      if (s.previewMs !== undefined && s.buildSeq !== undefined) useTimingStore.getState().setPreviewMs(s.buildSeq, s.previewMs)
    })
  )

  setOverlaySaver((name, doc) => trackSave(api.saveOverlay(name, doc)))
  setMenuSaver((name, doc) => {
    const p = api.saveMenuSettings(name, doc)
    trackSave(p)
    return p
  })
  // a library function that is open for editing is saved back into its pack folder (its store is named `@lib:<packId>`), then the pack set is read again
  setGraphSaver((name, graph) =>
    trackSave(
      name.startsWith('@lib:')
        ? api.saveLibraryFunction(name.slice('@lib:'.length), graph).then((r) => r.ok && reloadPacks())
        : name.startsWith('@comp:')
          ? api.saveComponentGraph(graph).then((r) => r.ok && setComponentGraph(graph))
          : api.saveGraph(name, graph)
    )
  )
  setGraphEditListener(graphEdited)

  // one selection model: selecting a layer opens its graph (a blank canvas when it has none)
  offs.push(
    useSelectionStore.subscribe((s, prev) => {
      const swfId = useProjectStore.getState().activeSwfId
      if (!s.component || s.component === prev.component || !swfId) return
      const follow = useGraphFollow.getState()
      if (follow.takeSkip() || follow.locked || s.inspects !== 'component') return // Ctrl+Click, the lock, or a graph node click that targets a layer
      const swf = useProjectStore.getState().project?.swfs.find((x) => x.id === swfId)
      const layer = swf?.ir.nodes[s.component]
      if (swf && layer) openLayerGraph({ id: swf.id, name: swf.name, root: swf.ir.root }, s.component, layer.name)
    })
  )

  // local -> other window
  offs.push(
    useSelectionStore.subscribe((s, prev) => {
      if (s.origin !== 'local') return
      const swfId = useProjectStore.getState().activeSwfId
      if (s.component && s.component !== prev.component && swfId) api.sendUiEvent({ type: 'select', swfId, nodeId: s.component })
      else if (!s.component && prev.component) api.sendUiEvent({ type: 'selectionCleared' })
    }),
    useProjectStore.subscribe((s, prev) => {
      if (s.activeSwfId && s.activeSwfId !== prev.activeSwfId) void api.setLastSwf(s.activeSwfId)
      if (s.activeSwfId && s.activeSwfId !== prev.activeSwfId && !remoteActive) api.sendUiEvent({ type: 'activeSwf', swfId: s.activeSwfId })
    })
  )
  // other window -> local
  let remoteActive = false
  offs.push(
    api.onUiEvent((e) => {
      if (e.type === 'activeSwf') {
        remoteActive = true
        useProjectStore.getState().setActiveSwf(e.swfId)
        remoteActive = false
      } else if (e.type === 'select') {
        remoteActive = true
        useProjectStore.getState().setActiveSwf(e.swfId)
        remoteActive = false
        useSelectionStore.getState().applyRemote(e.nodeId)
      } else useSelectionStore.getState().clear()
    })
  )

  // Figma -> Inkwell
  offs.push(
    api.onFigmaSelection((ids) => {
      const project = useProjectStore.getState().project
      if (!project) return
      const hit = useSelectionStore.getState().applyFigmaSelection(
        ids,
        project.swfs.map((s) => ({ swfId: s.id, has: (id: string) => !!s.ir.nodes[id] })),
        useProjectStore.getState().activeSwfId
      )
      if (hit && hit.swfId !== useProjectStore.getState().activeSwfId) useProjectStore.getState().setActiveSwf(hit.swfId)
    })
  )
  return () => offs.forEach((o) => o())
}
