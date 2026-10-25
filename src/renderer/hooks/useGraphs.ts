import { useEffect } from 'react'
import { useGraphDocs, loadSwfGraphs } from '../state/graphDocs'
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
  return { ids, activeId, store: swf && activeId ? findGraphStore(swf.id, activeId) : undefined, loaded: !!swf && !!docs.loaded[swf.id] }
}
