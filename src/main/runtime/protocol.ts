import { RUNTIME_PROTOCOL, RuntimeToEditor, SPEC_VERSION, type EditorToRuntime } from '@inkwell-ui/spec'
import type { DevEvent, DevMenu, DevPhase, DevReloadResult, DevRuntimeInfo } from '../../shared/devLink'

// Pure message handling of the editor's side of the S6 debug protocol: no socket, no timers. `reduce` takes the connection's state and one message from the runtime and
// returns the new state plus what to do (messages to send, events for the UI, a finished reload). The socket code (client.ts) only moves bytes.

/** What the connection knows about the runtime (the part of `DevState` that the protocol decides). */
export interface Core {
  phase: DevPhase
  runtime?: DevRuntimeInfo
  specMismatch: boolean
  menus: DevMenu[]
  message?: string
  /** Menus we sent `subscribe` for on this connection (subscriptions are lost on reconnect). */
  subscribed: string[]
}
export const freshCore = (phase: DevPhase = 'waiting'): Core => ({ phase, specMismatch: false, menus: [], subscribed: [] })

export interface Step {
  core: Core
  send: EditorToRuntime[]
  events: DevEvent[]
  /** An answer to a `reload` request. */
  reload?: { id: number; result: DevReloadResult }
  /** The connection is useless as it is: close it. `retry` says whether trying again can help. */
  close?: { retry: 'never' | 'slow' }
}

export const REFUSALS: Record<string, { phase: DevPhase; message: string; retry: 'never' | 'slow' }> = {
  unauthorized: { phase: 'unauthorized', message: 'The game refused the token. Run a Dev deploy again, or paste the token from Inkwell.ini (MO2 may have the file in the overwrite folder).', retry: 'never' },
  'protocol-mismatch': { phase: 'protocolMismatch', message: 'The editor and the Inkwell Runtime speak different debug protocol versions. Update the editor or the runtime so they match.', retry: 'never' },
  busy: { phase: 'busy', message: 'Another editor is already connected to the game. Close it, or wait: this editor retries.', retry: 'slow' }
}

const subscribeAll = (names: readonly string[], already: readonly string[]): EditorToRuntime[] =>
  names.filter((n) => !already.includes(n)).map((menu) => ({ type: 'subscribe', menu, watch: true, pins: true }))

/** The first message after connecting. Never logged: it carries the token. */
export const helloMessage = (token: string, editorVersion: string): EditorToRuntime => ({ type: 'hello', token, editorVersion, protocolVersion: RUNTIME_PROTOCOL, specVersion: SPEC_VERSION })

/** Parses one text frame. Unknown message types and non-JSON are `undefined` (ignored, S6: "receivers ignore unknown types"); a known type with a wrong shape too. */
export function parseServerMessage(text: string): RuntimeToEditor | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const r = RuntimeToEditor.safeParse(raw)
  return r.success ? r.data : undefined
}

export function reduce(core: Core, msg: RuntimeToEditor, at: number): Step {
  const same = (extra: Partial<Step> = {}): Step => ({ core, send: [], events: [], ...extra })
  switch (msg.type) {
    case 'helloAck': {
      if (!msg.ok) {
        const r = REFUSALS[msg.error ?? 'unauthorized'] ?? REFUSALS['unauthorized']!
        return { core: { ...core, phase: r.phase, message: r.message, menus: [], subscribed: [] }, send: [], events: [], close: { retry: r.retry } }
      }
      if (msg.protocolVersion !== RUNTIME_PROTOCOL) { // defensive: the runtime said ok but speaks another protocol
        const r = REFUSALS['protocol-mismatch']!
        return { core: { ...core, phase: r.phase, message: r.message }, send: [], events: [], close: { retry: r.retry } }
      }
      const menus = msg.menus.map((m) => ({ name: m.name, swf: m.swf, open: m.open }))
      const specMismatch = msg.specVersion !== SPEC_VERSION
      const runtime: DevRuntimeInfo = { versionString: msg.runtimeVersionString, packed: msg.runtimeVersion, gameVersion: msg.gameVersion, protocol: msg.protocolVersion, spec: msg.specVersion }
      const names = menus.map((m) => m.name)
      return {
        core: { phase: 'connected', runtime, specMismatch, menus, subscribed: names, message: specMismatch ? `Spec version differs (editor ${SPEC_VERSION}, runtime ${msg.specVersion}); connected anyway.` : undefined } as Core,
        send: subscribeAll(names, []), events: []
      }
    }
    case 'menuState': {
      if (core.phase !== 'connected') return same()
      const known = core.menus.some((m) => m.name === msg.menu)
      const menus = known ? core.menus.map((m) => (m.name === msg.menu ? { ...m, open: msg.open } : m)) : [...core.menus, { name: msg.menu, swf: '', open: msg.open }]
      const send = subscribeAll([msg.menu], core.subscribed) // a menu registered after the hello (hot reload, new file)
      return { core: { ...core, menus, subscribed: [...core.subscribed, ...send.map((s) => (s as { menu: string }).menu)] }, send, events: [{ k: 'menuState', menu: msg.menu, open: msg.open }] }
    }
    case 'trace':
      return core.phase !== 'connected' ? same() : same({
        events: [{ k: 'trace', at, ts: msg.ts, level: msg.level, source: msg.source, text: msg.text, ...(msg.menu ? { menu: msg.menu } : {}), ...(msg.node ? { node: msg.node } : {}), ...(msg.graph ? { graph: msg.graph } : {}) }]
      })
    case 'watch':
      return core.phase !== 'connected' ? same() : same({ events: [{ k: 'watch', menu: msg.menu, graph: msg.graph, scope: msg.scope, name: msg.name, value: msg.value }] })
    case 'pin':
      return core.phase !== 'connected' ? same() : same({ events: [{ k: 'pin', menu: msg.menu, node: msg.node, pin: msg.pin, value: msg.value }] })
    case 'reloadAck': {
      const result: DevReloadResult = { ok: msg.ok, reloaded: msg.reloaded, skipped: msg.skipped.map((s) => ({ name: s.name, reason: s.reason })), ms: msg.ms, ...(msg.error ? { error: msg.error } : {}) }
      // a reloaded menu has a new movie: subscribing again makes the runtime send the full variable dump for it (S6: "a full dump when you subscribe")
      const send: EditorToRuntime[] = msg.reloaded.map((menu) => ({ type: 'subscribe', menu, watch: true, pins: true }))
      return same({ send, reload: { id: msg.id, result } })
    }
    case 'error': {
      const refusal = REFUSALS[msg.code]
      if (refusal && core.phase !== 'connected') return { core: { ...core, phase: refusal.phase, message: refusal.message }, send: [], events: [], close: { retry: refusal.retry } }
      const events: DevEvent[] = [{ k: 'error', at, code: msg.code, message: msg.message }]
      // an error that answers a reload request ends it
      if (msg.id !== undefined && (msg.code === 'reload-failed' || msg.code === 'unknown-menu')) return same({ events, reload: { id: msg.id, result: { ok: false, reloaded: [], skipped: [], ms: 0, error: msg.message } } })
      return same({ events })
    }
    case 'ping':
      return same({ send: [{ type: 'pong', ...(msg.id !== undefined ? { id: msg.id } : {}) }] })
    case 'pong':
      return same()
  }
}
