import type { NodeDef } from '@inkwell-ui/spec'
import { useEffect, useState } from 'react'
import { defIndex } from '../../shared/graphs'
import { inkwell } from './api'

/** The node definitions of the loaded packs by `packId/kind@major` (data only, loaded once over IPC). Empty until the answer arrives. */
let cached: Promise<ReadonlyMap<string, NodeDef>> | undefined
const EMPTY: ReadonlyMap<string, NodeDef> = new Map()
export function usePacks(): ReadonlyMap<string, NodeDef> {
  const [defs, setDefs] = useState<ReadonlyMap<string, NodeDef>>(EMPTY)
  useEffect(() => {
    if (!inkwell) return
    cached ??= inkwell.getPacks().then(defIndex)
    let live = true
    void cached.then((d) => live && setDefs(d))
    return () => void (live = false)
  }, [])
  return defs
}
