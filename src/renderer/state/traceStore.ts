import { create } from 'zustand'
import { parseTrace, type TraceLine } from '../model/traceParse'

/**
 * The Ruffle preview's trace output (docs/debugging.md): the lines for the Runtime Trace panel and the last value of every pin the preview build traced
 * (`pins['<node>.<pin>']`, shown as badges on the canvas). Fed by the preview panel's backend (`push`); nothing is kept across sessions.
 * `pins` is cleared on every new preview build (`newBuild`), the lines stay (Clear Trace empties them).
 */
export interface TraceEntry {
  id: number
  at: number
  line: TraceLine
}
export interface TraceStore {
  lines: TraceEntry[]
  pins: Record<string, string>
  push(raw: string, at?: number): void
  clear(): void
  newBuild(): void
}
export const MAX_TRACE_LINES = 500
let next = 1

export const useTraceStore = create<TraceStore>()((set) => ({
  lines: [],
  pins: {},
  push: (raw, at = Date.now()) => {
    const line = parseTrace(raw)
    if (!line) return
    set((s) => ({
      lines: line.kind === 'pin' ? s.lines : [...s.lines.slice(-(MAX_TRACE_LINES - 1)), { id: next++, at, line }],
      pins: line.kind === 'pin' ? { ...s.pins, [`${line.node}.${line.pin}`]: line.value } : s.pins
    }))
  },
  clear: () => set({ lines: [], pins: {} }),
  newBuild: () => set({ pins: {} })
}))

/** The last traced value of one pin (undefined = none yet). */
export const usePinValue = (node: string, pin: string): string | undefined => useTraceStore((s) => s.pins[`${node}.${pin}`])
