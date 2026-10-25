import { useSwfHistory } from '../state/swfHistory'
import { redoSwf, undoSwf } from '../state/overlayStore'
import { useActiveSwf } from './useProject'

/** Undo/redo of the ACTIVE SWF's history (UX 5.5: one history per SWF; overlay and graph edits share it, state/swfHistory.ts). */
export function useUndo(): { swfName: string | undefined; canUndo: boolean; canRedo: boolean; undo(): void; redo(): void } {
  const swf = useActiveSwf()
  const c = useSwfHistory((s) => (swf ? s.counts[swf.id] : undefined))
  return {
    swfName: swf?.name,
    canUndo: (c?.undo ?? 0) > 0,
    canRedo: (c?.redo ?? 0) > 0,
    undo: () => swf && undoSwf(swf.id),
    redo: () => swf && redoSwf(swf.id)
  }
}
