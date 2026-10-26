import { EventEmitter } from 'node:events'
import { WebSocketServer, type WebSocket } from 'ws'
import { promoteStrict } from '../../shared/lint'
import type { Trust } from './figmaTrust'
import {
  ackHello,
  applyPatch,
  AssetHash,
  hashNode,
  imageHashes,
  PatchError,
  PluginMessage,
  PROTOCOL_VERSION,
  SelectNode,
  SPEC_VERSION,
  type EditorMessage,
  type Swf,
  type SyncIssue
} from '@inkwell-ui/spec'

// Figma plugin iframes are sandboxed, so browsers send `Origin: null`; no Origin = non-browser client.
// Any sandboxed iframe sends "null" too, so the origin check only filters real web origins; the user's approval of the plugin secret (protocol 4) is the defence.
const ALLOWED_ORIGINS = new Set<string | undefined>([undefined, 'null'])
/** A socket waiting for the user's answer is closed after this long. */
export const PENDING_TIMEOUT_MS = 60_000
export const SYNC_PORTS = [8787, 8788, 8789, 8790] // the plugin tries exactly this range

export interface ChangeResult {
  issues?: SyncIssue[]
}

export interface SyncServerOptions {
  editorVersion: string
  /** Ports tried in order; default 8787-8790. Use [0] for an ephemeral port (tests). */
  ports?: readonly number[]
  /** Who may connect (approve-on-connect, protocol 4). */
  trust: Trust
  /** Visual IR per swf, keyed by its folder name under swfs/. The swf's key in the server is `ir.id` (the top-level frame's Figma node id). */
  initial?: Record<string, Swf>
  debounceMs?: number
  /** Called once per debounced burst of patches to a swf. `name` is its folder / output name. A throw becomes an error status. */
  onChange?: (swfId: string, ir: Swf, name: string) => Promise<ChangeResult | void> | ChangeResult | void
  /** Strict Mode (design spec): while true, warnings count as errors in the build status (the build gate). Read on every build. */
  strict?: () => boolean
  /** Image assets (protocol 3): the server asks the plugin for missing hashes (`needAssets`) and stores what arrives. Without it, `asset` is refused. */
  assets?: { has(hash: string): boolean; put(hash: string, png: Buffer): Promise<void> }
}

export type SyncStatus = { swfId?: string; state: 'compiling' | 'synced' | 'error'; issues?: SyncIssue[] }
export interface SwfInfo {
  id: string
  name: string
  /** Its Figma frame is gone (or the plugin is on another page): data is kept, nothing is built. */
  orphaned: boolean
}
export interface Layer {
  id: string
  name: string
}

/** Folder-safe swf name from a frame name. shortcut: no Windows reserved-name check (CON, NUL...); add if a user hits it. */
export function sanitizeName(name: string, fallback: string): string {
  const n = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|_+$/g, '')
  return n || fallback.replace(/[^A-Za-z0-9._-]+/g, '_')
}

/** Nodes that no root reaches (derived, never stored). */
export function unreachableNodes(ir: Swf): string[] {
  const seen = new Set<string>()
  const stack = ir.nodes[ir.root] ? [ir.root] : []
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(ir.nodes[id]?.children ?? []))
  }
  return Object.keys(ir.nodes).filter((id) => !seen.has(id))
}

export const UNREACHABLE_MESSAGE = 'this layer is not inside an exported frame'

interface Entry {
  ir: Swf
  name: string
  orphaned: boolean
}

const emptySwf = (id: string, name: string): Swf =>
  ({ specVersion: SPEC_VERSION, id, name, target: { kind: 'hudWidget' }, stage: { width: 1280, height: 720 }, root: id, nodes: {} }) as Swf

/** Events: 'hello' ({pluginVersion, fileKey?} of an accepted plugin), 'selection' (ids), 'connections' (count), 'status' (SyncStatus with swfId), 'swfs' (SwfInfo[], loose Layer[]). */
export async function startSyncServer(opts: SyncServerOptions) {
  const events = new EventEmitter()
  const store = new Map<string, Entry>() // swf id -> state
  for (const [name, ir] of Object.entries(opts.initial ?? {})) store.set(ir.id, { ir, name, orphaned: false })
  let loose: Layer[] = []
  const ready = new Set<WebSocket>() // sockets that finished the hello handshake
  let selection: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let building = false
  const pending = new Set<string>()

  const asked = new WeakMap<WebSocket, Set<string>>() // hashes requested per connection: never twice on one socket
  /** Sends `needAssets` for the image hashes of `ir` the project lacks and this socket was not asked for yet. */
  const requestAssets = (ws: WebSocket, ir: Swf | undefined): void => {
    if (!opts.assets || !ir) return
    let mine = asked.get(ws)
    if (!mine) asked.set(ws, (mine = new Set()))
    const want = [...new Set(Object.values(ir.nodes).flatMap(imageHashes))].filter((h) => AssetHash.safeParse(h).success && !mine.has(h) && !opts.assets!.has(h))
    for (const h of want) mine.add(h)
    if (want.length) send(ws, { type: 'needAssets', hashes: want })
  }
  const send = (ws: WebSocket, m: EditorMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m))
  }
  const broadcast = (s: SyncStatus): void => {
    events.emit('status', s)
    for (const ws of ready) send(ws, { type: 'status', ...s })
  }
  const infos = (): SwfInfo[] => [...store].map(([id, e]) => ({ id, name: e.name, orphaned: e.orphaned }))
  const swfsChanged = (): void => {
    events.emit('swfs', infos(), loose)
  }
  /** Project-level status (no swfId): loose layers and orphaned swfs. */
  const projectStatus = (): void => {
    const issues: SyncIssue[] = [
      ...loose.map((l) => ({ code: 'unreachable-node', severity: 'warning', nodeId: l.id, message: `"${l.name}": ${UNREACHABLE_MESSAGE}.` })),
      ...infos().filter((i) => i.orphaned).map((i) => ({ code: 'orphaned-swf', severity: 'warning', nodeId: i.id, message: `"${i.name}": its Figma frame is gone; the swf and its data are kept.` }))
    ]
    for (const ws of ready) send(ws, { type: 'status', state: 'synced', ...(issues.length ? { issues } : {}) })
  }

  async function buildOne(swfId: string): Promise<void> {
    const e = store.get(swfId)
    if (!e || e.orphaned || !e.ir.nodes[e.ir.root]) return
    broadcast({ swfId, state: 'compiling' })
    try {
      const r = await opts.onChange?.(swfId, e.ir, e.name)
      const issues: SyncIssue[] = [
        ...(r?.issues ?? []),
        ...unreachableNodes(e.ir).map((id) => ({ code: 'unreachable-node', severity: 'warning', nodeId: id, message: `"${e.ir.nodes[id]!.name}": ${UNREACHABLE_MESSAGE}.` }))
      ]
      const shown = promoteStrict(issues, opts.strict?.() ?? false)
      const errors = shown.some((i) => (i as { severity?: string }).severity === 'error')
      broadcast({ swfId, state: errors ? 'error' : 'synced', ...(shown.length ? { issues: shown } : {}) })
    } catch (err) {
      broadcast({ swfId, state: 'error', issues: [{ code: 'build_failed', message: err instanceof Error ? err.message : String(err) }] })
    }
  }
  async function build(): Promise<void> {
    if (building) return // the running loop picks up what is pending
    building = true
    try {
      while (pending.size) {
        const id = pending.values().next().value as string
        pending.delete(id)
        await buildOne(id) // one at a time: the resident FFDec wrapper takes one job at a time
      }
    } finally {
      building = false
    }
  }
  const schedule = (swfId: string): void => {
    pending.add(swfId)
    clearTimeout(timer)
    timer = setTimeout(() => void build(), opts.debounceMs ?? 100)
  }

  /** Unique (case-insensitive: Windows folders) sanitized name among the other swfs. */
  function nameFor(swfId: string, wanted: string, current?: string): string {
    const base = sanitizeName(wanted, swfId)
    if (current && current.toLowerCase() === base.toLowerCase()) return current // never rename by case only
    const taken = new Set([...store].filter(([id]) => id !== swfId).map(([, e]) => e.name.toLowerCase()))
    let n = base
    for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base}_${i}`
    return n
  }

  const origins = new WeakMap<WebSocket, string>()
  const waiting = new Map<WebSocket, { abort(): void }>() // sockets that got `pending`: they may send nothing until the user answers

  async function admit(ws: WebSocket, m: Extract<PluginMessage, { type: 'hello' }>): Promise<void> {
    const ack = ackHello(m, opts.editorVersion)
    if (!ack.ok) {
      send(ws, ack)
      events.emit('handshakeFailed', ack.error ?? 'version mismatch')
      return ws.close(1008, 'version mismatch')
    }
    const ctl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const d = await opts.trust
      .decide(m.pluginSecret, { pluginVersion: m.pluginVersion, fileName: m.fileName, origin: origins.get(ws) ?? 'null' }, ctl.signal, () => {
        send(ws, { type: 'pending' })
        waiting.set(ws, { abort: () => ctl.abort() })
        timer = setTimeout(() => {
          send(ws, { type: 'denied', reason: 'timeout' })
          ctl.abort()
          ws.close(1008, 'approval timed out')
        }, PENDING_TIMEOUT_MS)
      })
      .finally(() => {
        clearTimeout(timer)
        waiting.delete(ws)
      })
    if (d === 'cancelled' || ws.readyState !== ws.OPEN) return
    if (d === 'known' || d === 'allowed') {
      send(ws, ack)
      ready.add(ws)
      events.emit('hello', { pluginVersion: m.pluginVersion, ...(m.fileKey ? { fileKey: m.fileKey } : {}) })
      events.emit('connections', ready.size)
    } else {
      send(ws, { type: 'denied', reason: d === 'busy' ? 'busy' : 'denied' })
      ws.close(1008, d)
    }
  }

  function handle(ws: WebSocket, raw: string): void {
    if (waiting.has(ws)) {
      // before approval nothing may be sent: any message ends the attempt (and withdraws the prompt)
      waiting.get(ws)!.abort()
      return ws.close(1008, 'not approved')
    }
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return send(ws, { type: 'error', code: 'bad_json', message: 'Message is not valid JSON' })
    }
    const parsed = PluginMessage.safeParse(json)
    const h = json as { type?: unknown; protocolVersion?: unknown; pluginVersion?: unknown } | null
    if (!parsed.success && h?.type === 'hello' && typeof h.protocolVersion === 'number' && h.protocolVersion !== PROTOCOL_VERSION) {
      // an older plugin has no pluginSecret: still tell it to update instead of answering "invalid message"
      const ack = ackHello({ pluginVersion: String(h.pluginVersion ?? '?'), protocolVersion: h.protocolVersion, specVersion: SPEC_VERSION } as never, opts.editorVersion)
      send(ws, ack)
      events.emit('handshakeFailed', ack.error ?? 'version mismatch')
      return ws.close(1008, 'version mismatch')
    }
    if (!parsed.success) {
      const t = (json as { type?: unknown } | null)?.type
      return send(ws, { type: 'error', code: 'invalid_message', message: `Unknown or invalid message${typeof t === 'string' ? ` "${t}"` : ''}: ${parsed.error.issues[0]?.message ?? ''}` })
    }
    const m = parsed.data
    if (m.type === 'hello') {
      if (ready.has(ws)) return send(ws, { type: 'error', code: 'duplicate_hello', message: 'Already connected' })
      void admit(ws, m).catch(() => ws.close(1011, 'internal error'))
      return
    }
    if (!ready.has(ws)) return send(ws, { type: 'error', code: 'no_hello', message: 'Send hello first' })
    if (m.type === 'selection') {
      selection = m.ids
      events.emit('selection', selection)
    } else if (m.type === 'hashTree') {
      const nodes = store.get(m.swfId)?.ir.nodes ?? {}
      const ids = Object.entries(m.nodeHashes)
        .filter(([id, h]) => !nodes[id] || hashNode(nodes[id]) !== h)
        .map(([id]) => id)
      send(ws, { type: 'resend', swfId: m.swfId, ids })
      requestAssets(ws, store.get(m.swfId)?.ir) // images of unchanged nodes may still be missing (e.g. a fresh checkout)
    } else if (m.type === 'swfs') {
      const frames = new Set(m.frames.map((f) => f.id))
      for (const [id, e] of store) e.orphaned = !frames.has(id) // kept either way; never deleted
      loose = m.loose.map((l) => ({ id: l.id, name: l.name }))
      swfsChanged()
      projectStatus()
    } else if (m.type === 'asset') {
      if (!opts.assets) return send(ws, { type: 'error', code: 'assets_unsupported', message: 'This editor session does not store images.' })
      const hash = m.hash
      void opts.assets.put(hash, Buffer.from(m.data, 'base64')).then(
        () => {
          // rebuild every swf that shows this image
          for (const [id, e] of store) if (!e.orphaned && Object.values(e.ir.nodes).some((n) => imageHashes(n).includes(hash))) schedule(id)
        },
        (err: unknown) => send(ws, { type: 'error', code: 'bad_asset', message: `Image ${hash}: ${err instanceof Error ? err.message : String(err)}` })
      )
    } else {
      try {
        const old = store.get(m.swfId)
        let ir = old?.ir ?? emptySwf(m.swfId, m.swf?.name ?? m.swfId)
        let name = old?.name ?? nameFor(m.swfId, m.swf?.name ?? m.swfId)
        if (m.swf) {
          name = nameFor(m.swfId, m.swf.name, old?.name)
          ir = { ...ir, name, stage: m.swf.stage, ...(m.swf.target ? { target: m.swf.target } : {}) }
        }
        const next = applyPatch(ir, m.patch)
        if (!next.nodes[next.root] && old?.ir.nodes[old.ir.root]) {
          // the frame itself was removed: keep the last good IR and mark the swf orphaned, never delete it
          old.orphaned = true
          swfsChanged()
          return
        }
        store.set(m.swfId, { ir: next, name, orphaned: false })
        if (!old || old.name !== name || old.orphaned) swfsChanged()
        schedule(m.swfId)
        requestAssets(ws, next)
      } catch (e) {
        if (!(e instanceof PatchError)) throw e
        send(ws, { type: 'error', code: e.code, message: e.message, nodeId: e.id })
        broadcast({ swfId: m.swfId, state: 'error', issues: [{ code: e.code, message: e.message, nodeId: e.id }] })
      }
    }
  }

  const wss = await listen(opts.ports ?? SYNC_PORTS, (reason) => events.emit('rejected', reason))
  wss.on('connection', (ws, req) => {
    origins.set(ws, req.headers.origin ?? 'none')
    ws.on('message', (data) => {
      try {
        handle(ws, data.toString())
      } catch (e) {
        send(ws, { type: 'error', code: 'internal', message: e instanceof Error ? e.message : String(e) })
      }
    })
    ws.on('close', () => {
      waiting.get(ws)?.abort()
      if (ready.delete(ws)) events.emit('connections', ready.size)
    })
  })
  const address = wss.address() as { port: number }
  return {
    port: address.port,
    events,
    swfs: infos,
    loose: (): readonly Layer[] => loose,
    ir: (swfId: string): Swf | undefined => store.get(swfId)?.ir,
    selection: (): readonly string[] => selection,
    connections: (): number => ready.size,
    /** Protocol 5: asks every approved, connected plugin to select (and with `focus` zoom to) a layer. Returns how many plugins were asked (0 = none connected). */
    selectNode: (nodeId: string, focus: boolean): number => {
      const m = nodeId ? SelectNode.safeParse({ type: 'selectNode', nodeId, focus }) : undefined
      if (!m?.success) return 0
      for (const ws of ready) send(ws, m.data)
      return ready.size
    },
    /** Forgets an orphaned swf (the caller already moved its folder away); a live one is refused. A returning Figma frame creates it fresh. */
    forget: (swfId: string): boolean => {
      if (!store.get(swfId)?.orphaned) return false
      store.delete(swfId)
      swfsChanged()
      projectStatus()
      return true
    },
    /** Queues a build of one swf (debounced like a patch), e.g. after its overlay changed. */
    rebuild: (swfId: string): void => schedule(swfId),
    /** Queues every swf that still has a Figma frame; returns how many. */
    rebuildAll: (): number => {
      const ids = [...store].filter(([, e]) => !e.orphaned && e.ir.nodes[e.ir.root]).map(([id]) => id)
      ids.forEach(schedule)
      return ids.length
    },
    /** Drops every connected plugin (after Settings forgot them): they must be approved again. */
    dropAll: (): void => {
      for (const ws of [...ready, ...waiting.keys()]) ws.close(1008, 'forgotten')
    },
    close: async (): Promise<void> => {
      clearTimeout(timer)
      for (const ws of wss.clients) ws.terminate()
      await new Promise<void>((r) => wss.close(() => r()))
    }
  }
}

/** First free port of the list wins; the last port's error is thrown. */
async function listen(ports: readonly number[], onReject: (reason: string) => void): Promise<WebSocketServer> {
  let last: unknown
  for (const port of ports) {
    try {
      return await new Promise<WebSocketServer>((resolve, reject) => {
        const wss: WebSocketServer = new WebSocketServer({
          host: '127.0.0.1', // never 0.0.0.0
          port,
          verifyClient: ({ origin }, done) => {
            if (!ALLOWED_ORIGINS.has(origin)) return onReject('origin'), done(false, 403, 'bad origin')
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
