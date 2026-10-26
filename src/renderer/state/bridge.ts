import { inkwell } from '../hooks/api'
import { useProjectStore } from './projectStore'
import { graphForComponent } from '../model/graphNav'
import { setActiveGraph, useGraphDocs } from './graphDocs'
import { setGraphSaver } from './graphStore'
import { getOverlayDoc, setOverlaySaver } from './overlayStore'
import { useSelectionStore } from './selectionStore'
import { useTimingStore } from './timingStore'
import { useSyncStore } from './syncStore'
import { usePopoutStore } from './popoutStore'
import { useDevStore } from './devStore'

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

  setOverlaySaver((name, doc) => void api.saveOverlay(name, doc))
  setGraphSaver((name, graph) => void api.saveGraph(name, graph))

  // one selection model: selecting a component opens its graph
  offs.push(
    useSelectionStore.subscribe((s, prev) => {
      const swfId = useProjectStore.getState().activeSwfId
      if (!s.component || s.component === prev.component || !swfId) return
      const docs = useGraphDocs.getState()
      const id = graphForComponent(getOverlayDoc(swfId), s.component, docs.ids[swfId] ?? [], docs.active[swfId])
      if (id) setActiveGraph(swfId, id)
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
