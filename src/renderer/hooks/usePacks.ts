import type { NodeDef } from '@inkwell-ui/spec'
import { useEffect, useState } from 'react'
import { defIndex, type PackSet } from '../../shared/graphs'
import { inkwell } from './api'

/** The node definitions of the loaded packs by `packId/kind@major` (data only, loaded once over IPC). Empty until the answer arrives. */
let cached: Promise<PackSet> | undefined
const EMPTY: ReadonlyMap<string, NodeDef> = new Map()
const NO_PACKS: readonly PackSummary[] = []
const packSet = (): Promise<PackSet> | undefined => inkwell && (cached ??= inkwell.getPacks())
export function usePacks(): ReadonlyMap<string, NodeDef> {
  const [defs, setDefs] = useState<ReadonlyMap<string, NodeDef>>(EMPTY)
  useEffect(() => {
    let live = true
    void packSet()?.then((s) => live && setDefs(defIndex(s)))
    return () => void (live = false)
  }, [])
  return defs
}

export interface PackSummary { id: string; version: string; nodes: number }
/** The loaded packs (id, version, node count) for the Assets panel and the status bar. Empty until the answer arrives. */
export function usePackList(): readonly PackSummary[] {
  const [list, setList] = useState(NO_PACKS)
  useEffect(() => {
    let live = true
    void packSet()?.then((s) => live && setList(s.packs.map((p) => ({ id: p.manifest.id, version: p.manifest.version, nodes: p.nodes.length }))))
    return () => void (live = false)
  }, [])
  return list
}
