import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { temporal, type TemporalState } from 'zundo'
import { patchNodeOverlay, type NodeOverlayPatch, type OverlayDoc } from '../../shared/overlay'

/**
 * Overlay documents with undo, ONE STORE (one zundo history) PER SWF (UX 5.5): switching SWFs switches histories. The overlay is the
 * only thing the editor edits; the visual IR is never touched, and undo never reverts it.
 *
 * - `getOverlayStore(swfId, name, initial)` creates the SWF's store once (from the overlay main loaded) and returns it. Later project pushes do
 *   NOT overwrite it: the renderer is the source of truth for overlays while the project is open (main only writes what we save).
 * - Every change (edit, undo, redo) is saved through the saver set by `setOverlaySaver` (IPC `saveOverlay`).
 * - `editNode(swfId, nodeId, patch)` is one history entry. Selection changes are not recorded (they are not in this store).
 * - `undoSwf(swfId)` / `redoSwf(swfId)`; `resetOverlays()` when another project opens.
 */
export interface OverlayState {
  doc: OverlayDoc
  setDoc(doc: OverlayDoc): void
}
export type OverlayStore = UseBoundStore<StoreApi<OverlayState>> & { temporal: StoreApi<TemporalState<Pick<OverlayState, 'doc'>>> }

interface Entry {
  name: string
  store: OverlayStore
}
const stores = new Map<string, Entry>()
let saver: ((name: string, doc: OverlayDoc) => void) | undefined

export const setOverlaySaver = (fn: ((name: string, doc: OverlayDoc) => void) | undefined): void => void (saver = fn)

export function getOverlayStore(swfId: string, name: string, initial: OverlayDoc): OverlayStore {
  const hit = stores.get(swfId)
  if (hit) {
    hit.name = name // a renamed frame keeps its history; saves go to the new folder
    return hit.store
  }
  const store = create<OverlayState>()(
    temporal((set) => ({ doc: initial, setDoc: (doc) => set({ doc }) }), { limit: 100, partialize: (s) => ({ doc: s.doc }) })
  ) as unknown as OverlayStore
  const entry: Entry = { name, store }
  stores.set(swfId, entry)
  store.subscribe((s, prev) => {
    if (s.doc !== prev.doc) saver?.(entry.name, s.doc)
  })
  return store
}

export function editNode(swfId: string, nodeId: string, patch: NodeOverlayPatch): void {
  const e = stores.get(swfId)
  if (!e) throw new Error(`No overlay store for swf ${swfId}`)
  e.store.getState().setDoc(patchNodeOverlay(e.store.getState().doc, nodeId, patch))
}
export const undoSwf = (swfId: string): void => stores.get(swfId)?.store.temporal.getState().undo()
export const redoSwf = (swfId: string): void => stores.get(swfId)?.store.temporal.getState().redo()
export const resetOverlays = (): void => stores.clear()
