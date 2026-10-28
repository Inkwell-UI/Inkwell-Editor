/**
 * Lines of the Ruffle preview's `trace()` output, as the generated AS2 writes them (docs/codegen.md, docs/debugging.md):
 * - Log node:        `[Inkwell] <info|warn|error> <nodeId>: <message>`
 * - handler failure: `[Inkwell] error <entryNodeId or throwing nodeId>: <message>` (same shape; `fail`)
 * - pin value:       `[Inkwell] pin <nodeId>.<pin> = <value>` (preview builds only)
 * - timer armed:     `[Inkwell] wait <nodeId> <ms> <key>`, its continuation ran `[Inkwell] waited <nodeId>`, Cancel Delay `[Inkwell] cancel <key>` (preview builds only)
 * - instance made: `[Inkwell] spawn <parent layer id> <component id> <clip path>`, removed `[Inkwell] despawn <clip path>` (preview builds only; Create and Remove Component; not lines of the Trace panel)
 * - node ran:        `[Inkwell] run <nodeId>` (preview builds only; an exec node, the graph canvas lights it; not a line of the Trace panel)
 * Any other trace line (a plain `trace()` of the movie, an `[Inkwell]` line of another shape) is shown as plain text.
 */
export type TraceLevel = 'info' | 'warn' | 'error'
export type TraceLine =
  | { kind: 'log'; level: TraceLevel; node: string; message: string }
  | { kind: 'pin'; node: string; pin: string; value: string }
  | { kind: 'run'; node: string }
  | { kind: 'wait'; node: string; ms: number; key: string }
  | { kind: 'waited'; node: string }
  | { kind: 'cancel'; key: string }
  | { kind: 'spawn'; parent: string; component: string; path: string }
  | { kind: 'despawn'; path: string }
  | { kind: 'bounds'; path: string; x: number; y: number; width: number; height: number }
  | { kind: 'text'; message: string }

export const TRACE_MARK = '[Inkwell]'

export function parseTrace(raw: string): TraceLine | null {
  const at = raw.indexOf(TRACE_MARK)
  if (at < 0) return raw.trim() ? { kind: 'text', message: raw.trim() } : null
  const s = raw.slice(at + TRACE_MARK.length).trim()
  const pin = /^pin (.+?)\.(\w+) = (.*)$/s.exec(s)
  if (pin) return { kind: 'pin', node: pin[1]!, pin: pin[2]!, value: pin[3]! }
  const wait = /^wait (\S+) (\S+) ?(.*)$/s.exec(s)
  if (wait) return { kind: 'wait', node: wait[1]!, ms: Number(wait[2]) || 0, key: wait[3]! }
  const waited = /^waited (\S+)$/.exec(s)
  if (waited) return { kind: 'waited', node: waited[1]! }
  const cancel = /^cancel (.*)$/s.exec(s)
  if (cancel) return { kind: 'cancel', key: cancel[1]! }
  const spawn = /^spawn (\S+) (\S+) (\S+)$/.exec(s)
  if (spawn) return { kind: 'spawn', parent: spawn[1]!, component: spawn[2]!, path: spawn[3]! }
  const bounds = /^bounds (\S+) (\S+) (\S+) (\S+) (\S+)$/.exec(s)
  if (bounds) return { kind: 'bounds', path: bounds[1]!, x: Number(bounds[2]), y: Number(bounds[3]), width: Number(bounds[4]), height: Number(bounds[5]) }
  const despawn = /^despawn (\S+)$/.exec(s)
  if (despawn) return { kind: 'despawn', path: despawn[1]! }
  const run = /^run (.+)$/s.exec(s)
  if (run) return { kind: 'run', node: run[1]!.trim() }
  const log = /^(info|warn|error) (.*?): (.*)$/s.exec(s)
  if (log) return { kind: 'log', level: log[1] as TraceLevel, node: log[2]!, message: log[3]! }
  return { kind: 'text', message: s }
}

/** `21:24:03.412` */
export function clockTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}
