import { RUNTIME_LIMITS, type EditorToRuntime } from '@inkwell-ui/spec'
import WebSocket from 'ws'
import { maskToken, type DevEvent, type DevReloadResult, type DevState, type TokenSource } from '../../shared/devLink'
import { freshCore, helloMessage, parseServerMessage, reduce, type Core } from './protocol'

// The editor's client of the Inkwell Runtime's debug server (SPEC-CHANGES S6, docs/dev-mode.md). It runs in the Electron MAIN process on the `ws` package (already a dependency
// for the Figma sync server): a `ws` client sends no `Origin` header (the runtime refuses any request that has one, which is why a renderer WebSocket cannot be used) and
// the `Host` header is `127.0.0.1:<port>`. All protocol decisions are in protocol.ts (pure); this file owns the socket, the timers, the reconnect backoff and the batching.

export interface DevConfig {
  token: string
  port: number
  source: TokenSource
  /** Where the token was read from (shown in the popover). */
  from?: string
}
/** What the client reports; main adds `devDeploy`. */
export type ClientState = Omit<DevState, 'devDeploy'>

export interface DevClientOptions {
  editorVersion: string
  /** Called before every attempt, so a token the game wrote later (MO2 overwrite) or a pasted one is picked up. `undefined` = no token known. */
  resolveConfig(): Promise<DevConfig | undefined> | DevConfig | undefined
  onState(s: ClientState): void
  /** Batches, at most every `flushMs`; a pin or watch value that was replaced inside a batch is delivered once (lossy by design, S6). */
  onEvents(events: DevEvent[]): void
  retry?: { initialMs?: number; maxMs?: number; slowMs?: number }
  handshakeMs?: number
  idleMs?: number
  reloadTimeoutMs?: number
  flushMs?: number
  now?: () => number
}

export function createDevClient(o: DevClientOptions) {
  const retry = { initialMs: 1000, maxMs: 10_000, slowMs: 15_000, ...o.retry }
  const handshakeMs = o.handshakeMs ?? RUNTIME_LIMITS.handshakeMs + 3000
  const idleMs = o.idleMs ?? RUNTIME_LIMITS.pongTimeoutMs + 5000 // the runtime pings every 10 s: silence this long means the peer is gone
  const reloadTimeoutMs = o.reloadTimeoutMs ?? 20_000
  const flushMs = o.flushMs ?? 50
  const now = o.now ?? Date.now

  let wanted = false
  let core: Core = freshCore('off')
  let cfg: DevConfig | undefined
  let session = 0
  let sock: WebSocket | undefined
  let gen = 0 // invalidates the callbacks of a replaced socket and of an attempt that was stopped while it resolved the config
  let backoff = 0
  let retryMode: 'never' | 'slow' | undefined
  let retryTimer: NodeJS.Timeout | undefined
  let hsTimer: NodeJS.Timeout | undefined
  let idleTimer: NodeJS.Timeout | undefined
  let flushTimer: NodeJS.Timeout | undefined
  let reloadSeq = 0
  const pending = new Map<number, { resolve(r: DevReloadResult): void; timer: NodeJS.Timeout }>()
  let buf: DevEvent[] = []
  let latest = new Map<string, number>()

  const state = (): ClientState => ({
    phase: core.phase, port: cfg?.port ?? 8788, tokenSource: cfg?.source ?? 'none', specMismatch: core.specMismatch, menus: core.menus, session,
    ...(cfg ? { tokenMasked: maskToken(cfg.token) } : {}), ...(cfg?.from ? { tokenFrom: cfg.from } : {}), ...(core.runtime ? { runtime: core.runtime } : {}), ...(core.message ? { message: core.message } : {})
  })
  const emit = (): void => o.onState(state())
  const set = (c: Core): void => {
    if (c === core) return
    const changed = JSON.stringify(c) !== JSON.stringify(core)
    core = c
    if (changed) emit()
  }

  const flush = (): void => {
    clearTimeout(flushTimer)
    flushTimer = undefined
    if (!buf.length) return
    const out = buf
    buf = []
    latest = new Map()
    o.onEvents(out)
  }
  const push = (e: DevEvent): void => {
    const key = e.k === 'pin' ? `p|${e.menu}|${e.node}|${e.pin}` : e.k === 'watch' ? `w|${e.menu}|${e.graph}|${e.scope}|${e.name}` : undefined
    const at = key ? latest.get(key) : undefined
    if (key && at !== undefined) buf[at] = e
    else {
      if (key) latest.set(key, buf.length)
      buf.push(e)
    }
    if (buf.length >= 500) flush()
    else flushTimer ??= setTimeout(flush, flushMs)
  }

  const send = (m: EditorToRuntime): boolean => {
    if (!sock || sock.readyState !== WebSocket.OPEN) return false
    try {
      sock.send(JSON.stringify(m))
      return true
    } catch {
      return false
    }
  }
  const failPending = (error: string): void => {
    for (const [id, p] of pending) {
      clearTimeout(p.timer)
      p.resolve({ ok: false, reloaded: [], skipped: [], ms: 0, error })
      pending.delete(id)
    }
  }
  const clearTimers = (): void => {
    clearTimeout(hsTimer)
    clearTimeout(idleTimer)
    hsTimer = idleTimer = undefined
  }
  const schedule = (ms: number): void => {
    clearTimeout(retryTimer)
    if (wanted) retryTimer = setTimeout(() => void connect(), ms)
  }
  const armIdle = (): void => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => sock?.terminate(), idleMs)
  }

  /** The socket is gone (closed by either side, or never opened): decide the next state and whether to try again. */
  function lost(wasOpen: boolean): void {
    clearTimers()
    sock = undefined
    failPending('The connection to the game was lost.')
    const refused = core.phase === 'unauthorized' || core.phase === 'protocolMismatch' || core.phase === 'busy' || core.phase === 'refused'
    if (!refused && core.phase !== 'off') set({ ...freshCore('waiting'), ...(wasOpen && core.phase === 'connected' ? { message: 'The game closed the connection.' } : {}) })
    if (!wanted || retryMode === 'never') return
    if (wasOpen && core.phase === 'waiting') backoff = 0 // it was a working session: come back quickly
    const ms = retryMode === 'slow' ? retry.slowMs : Math.min(retry.maxMs, retry.initialMs * 2 ** backoff++)
    schedule(ms)
  }

  async function connect(): Promise<void> {
    if (sock || !wanted) return
    const mine = ++gen
    let c: DevConfig | undefined
    try {
      c = await o.resolveConfig()
    } catch {
      c = undefined
    }
    if (mine !== gen || !wanted || sock) return
    cfg = c
    if (!c) {
      set({ ...freshCore('noToken'), message: 'No dev token yet. Run a Dev deploy, or paste the token from Inkwell.ini.' })
      emit()
      retryMode = 'slow'
      schedule(retry.slowMs) // the game may write the token later (MO2 overwrite)
      return
    }
    retryMode = undefined
    const ws = new WebSocket(`ws://127.0.0.1:${c.port}/`, { handshakeTimeout: handshakeMs, maxPayload: RUNTIME_LIMITS.maxMessageBytes, perMessageDeflate: false, followRedirects: false })
    sock = ws
    let opened = false
    ws.on('open', () => {
      if (sock !== ws) return
      opened = true
      set({ ...freshCore('connecting') })
      send(helloMessage(c.token, o.editorVersion))
      hsTimer = setTimeout(() => ws.terminate(), handshakeMs)
      armIdle()
    })
    ws.on('message', (data, isBinary) => {
      if (sock !== ws || isBinary) return
      armIdle()
      const msg = parseServerMessage(data.toString('utf8'))
      if (!msg) return
      const was = core.phase
      const step = reduce(core, msg, now())
      if (was !== 'connected' && step.core.phase === 'connected') {
        clearTimeout(hsTimer)
        session++
        backoff = 0
      }
      set(step.core)
      for (const m of step.send) send(m)
      for (const e of step.events) push(e)
      if (step.reload) {
        const p = pending.get(step.reload.id)
        if (p) {
          clearTimeout(p.timer)
          pending.delete(step.reload.id)
          p.resolve(step.reload.result)
        }
      }
      if (step.close) {
        retryMode = step.close.retry
        ws.close(1000)
        setTimeout(() => ws.terminate(), 1000).unref()
      }
    })
    ws.on('unexpected-response', (_req, res) => {
      if (sock !== ws) return
      res.resume()
      // 403: an Origin header or a foreign Host reached the server; neither is something a retry fixes
      set({ ...freshCore('refused'), message: `The game's debug server refused the connection (HTTP ${res.statusCode}).` })
      retryMode = 'never'
      ws.terminate()
    })
    ws.on('error', () => undefined) // the close event follows and decides; ECONNREFUSED is the normal "game not running"
    ws.on('close', () => {
      if (sock !== ws) return
      lost(opened)
    })
  }

  function start(): void {
      wanted = true
      backoff = 0
      clearTimeout(retryTimer)
      if (core.phase === 'off') set(freshCore('waiting'))
      if (sock && core.phase !== 'connected' && core.phase !== 'connecting') sock.terminate()
      void connect()
  }
  function stop(): void {
      wanted = false
      gen++
      clearTimeout(retryTimer)
      clearTimers()
      const s = sock
      sock = undefined
      s?.removeAllListeners('message')
      s?.on('error', () => undefined)
      s?.close(1000)
      setTimeout(() => s?.terminate(), 500).unref()
      failPending('Disconnected.')
      flush()
      set(freshCore('off'))
  }
  function restart(): void {
      const s = sock
      sock = undefined
      gen++
      clearTimers()
      s?.removeAllListeners('message')
      s?.on('error', () => undefined)
      s?.terminate()
      failPending('Reconnecting.')
      set(freshCore('waiting'))
      backoff = 0
      void connect()
  }

  return {
    /** Starts connecting (and keeps trying quietly while nothing listens). Also the Connect button. */
    start,
    /** Disconnect: closes the socket and stops retrying. */
    stop,
    /** The token or the port changed (paste, Dev deploy): try again right away, also after a refusal. */
    configChanged(): void {
      if (!wanted) return
      if (core.phase === 'connected') restart()
      else start()
    },
    /** Drops the current connection and connects again with the current config. */
    restart,
    /** Sends `reload` and waits for the ack. `menu` absent = every menu. Never rejects. */
    reload(menu?: string): Promise<DevReloadResult> {
      if (core.phase !== 'connected') return Promise.resolve({ ok: false, reloaded: [], skipped: [], ms: 0, error: 'The game is not connected.' })
      const id = ++reloadSeq
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          resolve({ ok: false, reloaded: [], skipped: [], ms: 0, error: 'The game did not answer the reload request.' })
        }, reloadTimeoutMs)
        pending.set(id, { resolve, timer })
        if (!send({ type: 'reload', id, ...(menu ? { menu } : {}) })) {
          clearTimeout(timer)
          pending.delete(id)
          resolve({ ok: false, reloaded: [], skipped: [], ms: 0, error: 'The game is not connected.' })
        }
      })
    },
    state,
    flush,
    isWanted: (): boolean => wanted
  }
}
export type DevClient = ReturnType<typeof createDevClient>
