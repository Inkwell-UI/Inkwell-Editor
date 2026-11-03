import { useCallback, useState } from 'react'
import { inkwell } from '../hooks/api'
import { useActiveOverlay, useActiveSwf } from '../hooks/useProject'
import { addFunction, removeGraph, renameGraph, useGraphDocs } from '../state/graphDocs'
import { strings } from '../../shared/strings'

/** New function, delete and rename for the active SWF (the Logic panel's Functions). A layer's graph is never created or deleted by hand: `state/graphDocs.ts` `openLayerGraph`. `error` is the last failure to show next to the control. */
export function useGraphActions(): { addFn(): Promise<void>; remove(id: string): Promise<void>; rename(id: string, name: string): void; error: string | undefined; canAdd: string | undefined } {
  const swf = useActiveSwf()
  const overlay = useActiveOverlay()
  const [error, setError] = useState<string>()
  const addFn = useCallback(async () => {
    if (!swf || !inkwell) return
    const n = (useGraphDocs.getState().ids[swf.id] ?? []).length + 1
    const r = await addFunction({ swf: { id: swf.id, name: swf.name }, name: `Function ${n}` }, inkwell)
    setError(r.ok ? undefined : r.error)
  }, [swf])
  const remove = useCallback(async (id: string) => {
    if (!swf || !inkwell) return
    const r = await removeGraph({ swf: { id: swf.id, name: swf.name }, overlay, graphId: id }, inkwell)
    setError(r.ok ? undefined : r.error)
  }, [swf, overlay])
  const rename = useCallback((id: string, name: string) => swf && name.trim() && renameGraph(swf.id, id, name.trim()), [swf])
  return { addFn, remove, rename, error, canAdd: !swf ? strings.nav.noSwf : swf.orphaned ? strings.graph.orphanedSwf : undefined }
}
