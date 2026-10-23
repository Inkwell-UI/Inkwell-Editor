import { EventEmitter } from 'node:events'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  ackHello,
  applyPatch,
  hashNode,
  PatchError,
  PluginMessage,
  SPEC_VERSION,
  type EditorMessage,
  type Swf,
  type SyncIssue
} from '@inkwell-ui/spec'

// Figma plugin iframes are sandboxed, so browsers send `Origin: null`; no Origin = non-browser client.
// Any sandboxed iframe sends "null" too, so the origin check only filters real web origins; the token is the defence.
const ALLOWED_ORIGINS = new Set<string | undefined>([undefined, 'null'])
export const SYNC_PORTS = [8787, 8788, 8789, 8790] // the plugin tries exactly this range

export interface ChangeResult {
  issues?: SyncIssue[]
}

export interface SyncServerOptions {
  editorVersion: string
  /** Ports tried in order; default 8787-8790. Use [0] for an ephemeral port (tests). */
  ports?: readonly number[]
  token?: string
  /** Visual IR per swf id, e.g. from the open project. */
  initial?: Record<string, Swf>
  /** Swf the plugin's patches apply to. The protocol carries no swf id (spec gap): default is the first initial swf, else "main". */
  swfId?: string
  debounceMs?: number
  /** Called once per debounced burst of patches. A throw becomes an error status. */
  onChange?: (swfId: string, ir: Swf) => Promise<ChangeResult | void> | ChangeResult | void
}

export type SyncStatus = { state: 'compiling' | 'synced' | 'error'; issues?: SyncIssue[] }

const emptySwf = (id: string): Swf =>
  ({ specVersion: SPEC_VERSION, id, name: id, target: { kind: 'hudWidget' }, stage: { width: 1280, height: 720 }, root: '', nodes: {} }) as Swf

/** Events: 'selection' (ids), 'connections' (count), 'status' (SyncStatus). */
export async function startSyncServer(opts: SyncServerOptions) {
  const token = opts.token ?? randomBytes(24).toString('hex')
  const events = new EventEmitter()
  const store = new Map<string, Swf>(Object.entries(opts.initial ?? {}))
  const swfId = opts.swfId ?? [...store.keys()][0] ?? 'main'
  if (!store.has(swfId)) store.set(swfId, emptySwf(swfId))
  const ready = new Set<WebSocket>() // sockets that finished the hello handshake
  let selection: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let building = false
  let dirty = false

  const send = (ws: WebSocket, m: EditorMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m))
  }
  const broadcast = (s: SyncStatus): void => {
    events.emit('status', s)
    for (const ws of ready) send(ws, { type: 'status', ...s })
  }

  async function build(): Promise<void> {
    if (building) {
      dirty = true // run again after the current build with the latest IR
      return
    }
    building = true
    try {
      do {
        dirty = false
        broadcast({ state: 'compiling' })
        try {
          const r = await opts.onChange?.(swfId, store.get(swfId)!)
          const errors = r?.issues?.some((i) => (i as { severity?: string }).severity === 'error')
          broadcast({ state: errors ? 'error' : 'synced', ...(r?.issues?.length ? { issues: r.issues } : {}) })
        } catch (e) {
          broadcast({ state: 'error', issues: [{ code: 'build_failed', message: e instanceof Error ? e.message : String(e) }] })
        }
      } while (dirty)
    } finally {
      building = false
    }
  }
  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => void build(), opts.debounceMs ?? 100)
  }

  function handle(ws: WebSocket, raw: string): void {
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return send(ws, { type: 'error', code: 'bad_json', message: 'Message is not valid JSON' })
    }
    const parsed = PluginMessage.safeParse(json)
    if (!parsed.success) {
      const t = (json as { type?: unknown } | null)?.type
      return send(ws, { type: 'error', code: 'invalid_message', message: `Unknown or invalid message${typeof t === 'string' ? ` "${t}"` : ''}: ${parsed.error.issues[0]?.message ?? ''}` })
    }
    const m = parsed.data
    if (m.type === 'hello') {
      const ack = ackHello(m, opts.editorVersion)
      send(ws, ack)
      if (ack.ok) {
        ready.add(ws)
        events.emit('connections', ready.size)
      } else ws.close(1008, 'version mismatch')
      return
    }
    if (!ready.has(ws)) return send(ws, { type: 'error', code: 'no_hello', message: 'Send hello first' })
    if (m.type === 'selection') {
      selection = m.ids
      events.emit('selection', selection)
    } else if (m.type === 'hashTree') {
      const nodes = store.get(swfId)!.nodes
      const ids = Object.entries(m.nodeHashes)
        .filter(([id, h]) => !nodes[id] || hashNode(nodes[id]) !== h)
        .map(([id]) => id)
      send(ws, { type: 'resend', ids })
    } else {
      try {
        let next = applyPatch(store.get(swfId)!, m.patch)
        // The protocol carries no swf metadata, so a fresh store takes the first parentless node as root.
        if (!next.root) {
          const root = Object.values(next.nodes).find((n) => n.parent === null)
          if (root) next = { ...next, root: root.id }
        }
        store.set(swfId, next)
        schedule()
      } catch (e) {
        if (!(e instanceof PatchError)) throw e
        send(ws, { type: 'error', code: e.code, message: e.message, nodeId: e.id })
        broadcast({ state: 'error', issues: [{ code: e.code, message: e.message, nodeId: e.id }] })
      }
    }
  }

  const wss = await listen(opts.ports ?? SYNC_PORTS, token)
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        handle(ws, data.toString())
      } catch (e) {
        send(ws, { type: 'error', code: 'internal', message: e instanceof Error ? e.message : String(e) })
      }
    })
    ws.on('close', () => {
      if (ready.delete(ws)) events.emit('connections', ready.size)
    })
  })
  const address = wss.address() as { port: number }
  return {
    port: address.port,
    token,
    events,
    swfId,
    ir: (): Swf => store.get(swfId)!,
    selection: (): readonly string[] => selection,
    connections: (): number => ready.size,
    close: async (): Promise<void> => {
      clearTimeout(timer)
      for (const ws of wss.clients) ws.terminate()
      await new Promise<void>((r) => wss.close(() => r()))
    }
  }
}

/** First free port of the list wins; the last port's error is thrown. */
async function listen(ports: readonly number[], token: string): Promise<WebSocketServer> {
  let last: unknown
  for (const port of ports) {
    try {
      return await new Promise<WebSocketServer>((resolve, reject) => {
        const wss: WebSocketServer = new WebSocketServer({
          host: '127.0.0.1', // never 0.0.0.0
          port,
          verifyClient: ({ origin, req }, done) => {
            if (!ALLOWED_ORIGINS.has(origin)) return done(false, 403, 'bad origin')
            const given = Buffer.from(new URL(req.url ?? '/', 'ws://x').searchParams.get('token') ?? '')
            const want = Buffer.from(token)
            if (given.length !== want.length || !timingSafeEqual(given, want)) return done(false, 401, 'bad token')
            done(true)
          }
        })
        wss.once('listening', () => resolve(wss))
        wss.once('error', reject)
      })
    } catch (e) {
      last = e
    }
  }
  throw last
}
