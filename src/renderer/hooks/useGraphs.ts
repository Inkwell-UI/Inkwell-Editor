import { useEffect } from 'react'
import { useGraphDocs, loadSwfGraphs, openLayerGraph } from '../state/graphDocs'
import { findGraphStore, type GraphStore } from '../state/graphStore'
import { inkwell } from './api'
import { useActiveSwf } from './useProject'

/** The active SWF's graphs: loads them once, then returns their ids (file order) and the open graph's id and store. */
export function useSwfGraphs(): { ids: string[]; activeId: string | undefined; store: GraphStore | undefined; loaded: boolean } {
  const swf = useActiveSwf()
  const docs = useGraphDocs()
  useEffect(() => {
    if (swf && inkwell) void loadSwfGraphs(swf, inkwell)
  }, [swf?.id, swf?.name]) // eslint-disable-line react-hooks/exhaustive-deps
  const ids = (swf && docs.ids[swf.id]) || []
  const activeId = swf ? docs.active[swf.id] : undefined
  const loaded = !!swf && !!docs.loaded[swf.id]
  // nothing open (the SWF has no graph yet): the frame's blank canvas
  useEffect(() => {
    if (swf && loaded && !activeId && !swf.orphaned) openLayerGraph({ id: swf.id, name: swf.name, root: swf.ir.root }, swf.ir.root, swf.name)
  }, [swf, loaded, activeId])
  return { ids, activeId, store: swf && activeId ? findGraphStore(swf.id, activeId) : undefined, loaded }
}
