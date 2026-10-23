import { useStore } from 'zustand'
import { create } from 'zustand'
import { getOverlayStore, redoSwf, undoSwf } from '../state/overlayStore'
import { useActiveSwf } from './useProject'

const none = create(() => ({ pastStates: [] as unknown[], futureStates: [] as unknown[] }))

/** Undo/redo of the ACTIVE SWF's overlay history (UX 5.5: one history per SWF). `scope` is what the status bar shows. */
export function useUndo(): { swfName: string | undefined; canUndo: boolean; canRedo: boolean; undo(): void; redo(): void } {
  const swf = useActiveSwf()
  const store = swf ? getOverlayStore(swf.id, swf.name, swf.overlay) : undefined
  const past = useStore(store?.temporal ?? none, (s) => s.pastStates.length)
  const future = useStore(store?.temporal ?? none, (s) => s.futureStates.length)
  return {
    swfName: swf?.name,
    canUndo: past > 0,
    canRedo: future > 0,
    undo: () => swf && undoSwf(swf.id),
    redo: () => swf && redoSwf(swf.id)
  }
}
