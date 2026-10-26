import { create } from 'zustand'
import { formatDevValue, initialDevState, type DevEvent, type DevScope, type DevState } from '../../shared/devLink'
import { strings } from '../strings'
import { useTraceStore } from './traceStore'

/**
 * The game dev connection as the renderer sees it (docs/dev-mode.md): the connection state, the trace lines the runtime streamed, the variable watch table and the last
 * value of every pin. Fed by the bridge (`setState`, `apply`). Pin and watch values belong to a session: a new hello (`session` counts up) starts them afresh; trace lines
 * stay (Clear Trace empties them). When the connection drops everything stays visible, greyed out by the panel (UX 4.6 Tab 3).
 */
export type TraceSource = 'ruffle' | 'game'
export interface GameLine {
  id: number
  at: number
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error'
  source: 'as2' | 'runtime'
  menu?: string
  node?: string
  graph?: string
  text: string
  /** A marker the editor wrote (a new session), not a runtime line. */
  note?: boolean
}
export interface WatchRow {
  key: string
  menu: string
  graph: string
  scope: DevScope
  name: string
  value: string
}
export interface DevStore {
  dev: DevState
  source: TraceSource
  lines: GameLine[]
  watch: Record<string, WatchRow>
  /** `<node>.<pin>` -> the value as text. */
  pins: Record<string, string>
  /** Something arrived in this window's lifetime: the empty state ("Start Skyrim with Dev Mode") only shows before that. */
  seen: boolean
  setSource(s: TraceSource): void
  setState(s: DevState): void
  apply(events: DevEvent[]): void
  clear(): void
}
export const MAX_GAME_LINES = 500
let next = 1

export const useDevStore = create<DevStore>()((set) => ({
  dev: initialDevState(),
  source: 'ruffle',
  lines: [],
  watch: {},
  pins: {},
  seen: false,
  setSource: (source) => set({ source }),
  setState: (dev) =>
    set((s) => {
      if (dev.session === s.dev.session || dev.phase !== 'connected') return { dev }
      // a new session: the old values are from another run of the game
      const note: GameLine = { id: next++, at: Date.now(), level: 'info', source: 'runtime', text: strings.dev.sessionStart(dev.runtime?.versionString ?? '?', dev.runtime?.gameVersion ?? '?'), note: true }
      return { dev, watch: {}, pins: {}, seen: true, lines: [...s.lines.slice(-(MAX_GAME_LINES - 1)), note] }
    }),
  apply: (events) =>
    set((s) => {
      let lines = s.lines
      let watch = s.watch
      let pins = s.pins
      for (const e of events) {
        if (e.k === 'trace' || e.k === 'error') {
          const line: GameLine = e.k === 'trace'
            ? { id: next++, at: e.at, level: e.level, source: e.source, text: e.text, ...(e.menu ? { menu: e.menu } : {}), ...(e.node ? { node: e.node } : {}), ...(e.graph ? { graph: e.graph } : {}) }
            : { id: next++, at: e.at, level: 'warn', source: 'runtime', text: `[${e.code}] ${e.message}` }
          lines = lines.length >= MAX_GAME_LINES ? [...lines.slice(-(MAX_GAME_LINES - 1)), line] : [...lines, line]
        } else if (e.k === 'watch') {
          const key = `${e.menu}|${e.graph}|${e.scope}|${e.name}`
          watch = { ...watch, [key]: { key, menu: e.menu, graph: e.graph, scope: e.scope, name: e.name, value: formatDevValue(e.value) } }
        } else if (e.k === 'pin') pins = { ...pins, [`${e.node}.${e.pin}`]: formatDevValue(e.value) }
      }
      return { lines, watch, pins, seen: true }
    }),
  clear: () => set({ lines: [], watch: {}, pins: {} })
}))

/** The value badge of one output pin, from the source the Trace panel is on: the Ruffle preview's last trace, or the game's last streamed value (marked `game`). */
export function usePinBadge(node: string, pin: string): { value: string; game: boolean } | undefined {
  const game = useDevStore((s) => s.source === 'game')
  const g = useDevStore((s) => (s.source === 'game' ? s.pins[`${node}.${pin}`] : undefined))
  const p = useTraceStore((s) => (s.pins[`${node}.${pin}`]))
  if (game) return g !== undefined ? { value: g, game: true } : undefined
  return p !== undefined ? { value: p, game: false } : undefined
}

/** Table order: Component, Menu, Saved, then by name. */
const SCOPE_ORDER: Record<DevScope, number> = { component: 0, menu: 1, saved: 2 }
export const sortedWatch = (w: Record<string, WatchRow>): WatchRow[] =>
  Object.values(w).sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || a.name.localeCompare(b.name) || a.graph.localeCompare(b.graph))
