import type { StoreApi } from 'zustand'
import { create } from 'zustand'
import type { TemporalState } from 'zundo'

/**
 * ONE undo history per SWF (UX 5.5) made of several zundo stores: the overlay store and one store per open graph. Each store keeps its own
 * entries (Knotwork's createHistory for graphs: typing coalesces, a drag is one entry, selection is not recorded); this file keeps the ORDER
 * in which the SWF's stores recorded them, so Undo reverts the latest edit of the SWF wherever it was made and Redo replays it.
 * Why not one store: Knotwork's history snapshots one `nodes` array, and a SWF has several graphs plus the overlay. A new edit clears Redo.
 */
type Temporal = StoreApi<TemporalState<Record<string, unknown>>>
interface Hist {
  stores: Map<string, Temporal>
  undo: string[]
  redo: string[]
}
const hists = new Map<string, Hist>()
let busy = false // our own undo/redo moves entries between a store's past and future; those are not new edits

/** Reactive counts for the status bar and the Undo buttons. */
export const useSwfHistory = create<{ counts: Record<string, { undo: number; redo: number }> }>(() => ({ counts: {} }))
const publish = (swfId: string): void => {
  const h = hists.get(swfId)
  if (h) useSwfHistory.setState((s) => ({ counts: { ...s.counts, [swfId]: { undo: h.undo.length, redo: h.redo.length } } }))
}

/** `temporal` is a zundo store's `.temporal`; `key` names it within the SWF (`overlay`, `graph:<id>`). Registering again replaces it. */
export function registerHistory(swfId: string, key: string, temporal: unknown): void {
  const t = temporal as Temporal
  const h: Hist = hists.get(swfId) ?? { stores: new Map(), undo: [], redo: [] }
  hists.set(swfId, h)
  h.stores.set(key, t)
  t.subscribe((s, prev) => {
    const top = s.pastStates[s.pastStates.length - 1]
    if (busy || !top || top === prev.pastStates[prev.pastStates.length - 1]) return
    h.undo.push(key)
    h.redo = []
    publish(swfId)
  })
  publish(swfId)
}

const step = (swfId: string, from: 'undo' | 'redo'): void => {
  const h = hists.get(swfId)
  if (!h) return
  const to = from === 'undo' ? 'redo' : 'undo'
  while (h[from].length) {
    const key = h[from].pop()!
    const t = h.stores.get(key)?.getState()
    if (!t || !(from === 'undo' ? t.pastStates : t.futureStates).length) continue // cleared or trimmed by the store: skip the stale entry
    busy = true
    try {
      from === 'undo' ? t.undo() : t.redo()
    } finally {
      busy = false
    }
    h[to].push(key)
    break
  }
  publish(swfId)
}
export const undoSwf = (swfId: string): void => step(swfId, 'undo')
export const redoSwf = (swfId: string): void => step(swfId, 'redo')
export function resetSwfHistory(): void {
  hists.clear()
  useSwfHistory.setState({ counts: {} })
}
