import type { NodeDef } from '@inkwell-ui/spec'
import { useEffect, useState } from 'react'
import { defIndex, type PackSet } from '../../shared/graphs'
import { inkwell } from './api'
import { useProject } from './useProject'

/** The node definitions of the loaded packs by `packId/kind@major` (data only, over IPC). Loaded once per pack set: a project switch or a pack install reloads. */
let cached: Promise<PackSet> | undefined
let generation = 0
const listeners = new Set<() => void>()
/** Drops the cached pack set: every hook asks main again (after an install, a restore, or another project). */
export function reloadPacks(): void {
  cached = undefined
  generation++
  for (const l of listeners) l()
}
const EMPTY: ReadonlyMap<string, NodeDef> = new Map()
const NO_PACKS: readonly PackSummary[] = []
const packSet = (): Promise<PackSet> | undefined => inkwell && (cached ??= inkwell.getPacks())
let lastDir: string | undefined | null = null // null = not seen yet

/** Re-renders on `reloadPacks`, and reloads when the open project changes (each project has its own packs.lock). */
function usePackGeneration(): number {
  const dir = useProject()?.dir
  const [gen, setGen] = useState(generation)
  useEffect(() => {
    const l = (): void => setGen(generation)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  useEffect(() => {
    if (lastDir !== null && lastDir !== dir) reloadPacks()
    lastDir = dir
  }, [dir])
  return gen
}

export function usePacks(): ReadonlyMap<string, NodeDef> {
  const [defs, setDefs] = useState<ReadonlyMap<string, NodeDef>>(EMPTY)
  const gen = usePackGeneration()
  useEffect(() => {
    let live = true
    void packSet()?.then((s) => live && setDefs(defIndex(s)))
    return () => void (live = false)
  }, [gen])
  return defs
}

export interface PackSummary { id: string; version: string; nodes: number }
/** The loaded packs (id, version, node count) for the Assets panel and the status bar. Empty until the answer arrives. */
export function usePackList(): readonly PackSummary[] {
  const [list, setList] = useState(NO_PACKS)
  const gen = usePackGeneration()
  useEffect(() => {
    let live = true
    void packSet()?.then((s) => live && setList(s.packs.map((p) => ({ id: p.manifest.id, version: p.manifest.version, nodes: p.nodes.length }))))
    return () => void (live = false)
  }, [gen])
  return list
}
