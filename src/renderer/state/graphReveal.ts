import { setActiveGraph, useGraphDocs } from './graphDocs'
import { findGraphStore } from './graphStore'
import { useProjectStore } from './projectStore'
import { useSelectionStore } from './selectionStore'
import { useWorkspaceStore } from './workspaceStore'

/**
 * Opens a graph node from anywhere (a Lint dock row, a trace line): activates the SWF and the graph, switches to the Behaviour mode (the only one
 * with the Graph panel) and selects the node; the Graph panel centres it (`selectionStore.reveal`). Returns false when the SWF is not in the project.
 */
export function openGraphNode(o: { swfName: string; graph: string; node: string; lintKey?: string; component?: string }): boolean {
  const swf = useProjectStore.getState().project?.swfs.find((s) => s.name === o.swfName)
  if (!swf) return false
  useProjectStore.getState().setActiveSwf(swf.id)
  setActiveGraph(swf.id, o.graph)
  if (useWorkspaceStore.getState().active !== 'behaviour') useWorkspaceStore.getState().setActive('behaviour')
  const sel = useSelectionStore.getState()
  if (o.lintKey) sel.selectFromLint({ key: o.lintKey, ...(o.component ? { nodeId: o.component } : {}), graphNode: o.node, graph: o.graph })
  else sel.revealGraphNode(o.graph, o.node)
  return true
}

/** The id of the SWF's graph that holds `nodeId` (graph node ids are unique inside a graph; the first graph wins), if the SWF's graphs are loaded. */
export function graphOfNode(swfId: string, nodeId: string): string | undefined {
  return (useGraphDocs.getState().ids[swfId] ?? []).find((id) => findGraphStore(swfId, id)?.getState().nodes.some((n) => n.id === nodeId))
}
