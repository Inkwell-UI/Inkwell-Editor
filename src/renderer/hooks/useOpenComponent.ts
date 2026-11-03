import { useEffect, useMemo } from 'react'
import { inkwell } from './api'
import { useActiveSwf, useProject } from './useProject'
import { useSyncState } from './useSyncState'
import { componentRows } from '../model/componentList'
import { createComponentGraph, loadComponentGraphs, useComponentGraphs } from '../state/componentGraphs'
import { menuGraphId, openComponentGraph, setActiveGraph, useGraphDocs } from '../state/graphDocs'
import { useSelectionStore } from '../state/selectionStore'
import { useToastStore } from '../state/toastStore'
import { strings } from '../../shared/strings'

/** Every component the project has, and the actions that open one's graph (made on first use) or go back to the active SWF's menu graph. Shared by the Logic panel's Components list and the Navigator's source dropdown. */
export function useOpenComponent() {
  const project = useProject()
  const swf = useActiveSwf()
  const sync = useSyncState()
  const graphs = useComponentGraphs((s) => s.graphs)
  const activeId = useGraphDocs((s) => (swf ? s.active[swf.id] : undefined))
  useEffect(() => void (inkwell && loadComponentGraphs(inkwell)), [project?.dir])
  const rows = useMemo(() => componentRows((project?.swfs ?? []).map((s) => s.ir), sync?.pageComponents), [project, sync?.pageComponents])
  // the graph of a component: made on first use, then opened in the Graph panel (which borrows the active SWF)
  const openGraph = async (id: string, name: string): Promise<void> => {
    if (!inkwell || !swf) return
    useSelectionStore.getState().clear() // nothing selected: the Inspector shows this graph's props
    const have = graphs[id] ?? (await createComponentGraph(id, name, inkwell).then((r) => (r.ok ? r.graph : undefined)))
    if (!have) return void useToastStore.getState().push({ tone: 'error', title: strings.comp.graphFailed })
    openComponentGraph({ id: swf.id, name: swf.name }, have)
  }
  /** Back to the SWF's menu graph (the first graph when it has no menu graph). */
  const openMenu = (): void => {
    if (!swf) return
    useSelectionStore.getState().clear()
    setActiveGraph(swf.id, menuGraphId(swf.id) ?? useGraphDocs.getState().ids[swf.id]?.[0])
  }
  return { rows, graphs, activeId, openGraph, openMenu }
}
