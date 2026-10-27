import { inkwell } from '../hooks/api'
import { strings } from '../strings'
import { loadSwfGraphs, useGraphDocs } from './graphDocs'
import { findGraphStore } from './graphStore'
import { editOverlay, getOverlayDoc } from './overlayStore'
import { useToastStore } from './toastStore'

type Api = Parameters<typeof loadSwfGraphs>[1]
interface SwfRef {
  id: string
  name: string
}

/** Asks, then moves an orphaned SWF's folder to `.trash` in the project (nothing is deleted); a toast says where it went or why not. The Navigator and the SWF switcher share it. */
export async function discardOrphanSwf(swf: SwfRef): Promise<void> {
  if (!inkwell || !window.confirm(strings.nav.discardSwfConfirm(swf.name))) return
  const r = await inkwell.discardSwf(swf.id)
  useToastStore.getState().push(r.ok ? { tone: 'info', title: strings.nav.discardedSwf(swf.name), text: r.trash } : { tone: 'error', title: strings.nav.discardSwfFailed, text: r.error })
}

/** Discards the overlay entry of a layer that no longer exists (one undoable overlay edit). */
export const discardOverlayOrphan = (swfId: string, nodeId: string): void =>
  editOverlay(swfId, (doc) => {
    const { [nodeId]: _gone, ...nodes } = doc.nodes ?? {}
    return { ...doc, nodes }
  })

/**
 * Moves the overlay entry of a deleted layer (`from`) to a live layer (`to`) and points every graph node that targets `from` at `to`.
 * Refuses when `to` already has behavior (nothing is merged or overwritten). shortcut: the overlay move and each graph retarget are separate
 * undo steps of the SWF's one history (no cross-store grouping yet), upgrade when swfHistory can group entries.
 */
export async function relinkOverlayOrphan(swf: SwfRef, from: string, to: string, api: Api): Promise<{ ok: true } | { ok: false; error: 'same' | 'taken' | 'missing' }> {
  const entry = getOverlayDoc(swf.id)?.nodes?.[from]
  if (!entry) return { ok: false, error: 'missing' }
  if (from === to) return { ok: false, error: 'same' }
  if (getOverlayDoc(swf.id)?.nodes?.[to]) return { ok: false, error: 'taken' }
  await loadSwfGraphs(swf, api)
  for (const graphId of useGraphDocs.getState().ids[swf.id] ?? []) {
    const g = findGraphStore(swf.id, graphId)?.getState()
    if (!g) continue
    for (const n of g.nodes) for (const [field, v] of Object.entries(n.data.fields ?? {})) if (v === from) g.setField(n.id, field, to)
  }
  editOverlay(swf.id, (doc) => {
    const { [from]: moved, ...rest } = doc.nodes ?? {}
    return { ...doc, nodes: { ...rest, [to]: moved! } }
  })
  return { ok: true }
}
