import { useCallback, useState } from 'react'
import { inkwell } from '../hooks/api'
import { useActiveOverlay, useActiveSwf } from '../hooks/useProject'
import { addGraph, removeGraph, renameGraph } from '../state/graphDocs'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../strings'

/** `[+ Graph]`, delete and rename for the active SWF (Navigator and Graph panel share them). `error` is the last failure to show next to the control. */
export function useGraphActions(): { add(): Promise<void>; remove(id: string): Promise<void>; rename(id: string, name: string): void; error: string | undefined; canAdd: string | undefined } {
  const swf = useActiveSwf()
  const overlay = useActiveOverlay()
  const component = useSelectionStore((s) => s.component)
  const [error, setError] = useState<string>()
  const add = useCallback(async () => {
    if (!swf || !inkwell) return
    const r = await addGraph({ swf: { id: swf.id, name: swf.name, root: swf.ir.root }, overlay, component: component && swf.ir.nodes[component] ? component : undefined, name: (scope) => (scope === 'menu' || !component ? swf.name : (swf.ir.nodes[component]?.name ?? swf.name)) }, inkwell)
    setError(r.ok ? undefined : r.error)
  }, [swf, overlay, component])
  const remove = useCallback(async (id: string) => {
    if (!swf || !inkwell) return
    const r = await removeGraph({ swf: { id: swf.id, name: swf.name }, overlay, graphId: id }, inkwell)
    setError(r.ok ? undefined : r.error)
  }, [swf, overlay])
  const rename = useCallback((id: string, name: string) => swf && name.trim() && renameGraph(swf.id, id, name.trim()), [swf])
  return { add, remove, rename, error, canAdd: !swf ? strings.nav.noSwf : swf.orphaned ? strings.graph.orphanedSwf : undefined }
}
