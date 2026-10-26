// A MOCK of the Inkwell Runtime's debug server (SPEC-CHANGES S6) for the tests: engine-free, plain `node:net`, the server side of RFC 6455 written out by hand so the editor's
// client is checked against bytes, not against the `ws` package that it is built on. It behaves like Runtime `tests/dev_tests.cpp` / `scripts/dev-client.mjs` show:
// 403 on an Origin header or a foreign Host, hello within 5 s, helloAck {ok:false, error} + close 1008 for a bad token / protocol, `error busy` + close for a second editor,
// ping every N ms, `unknown-menu` errors, reloadAck. Tests drive the rest through `send` and read what the editor sent from `received`.
import { createHash, timingSafeEqual } from 'node:crypto'
import net from 'node:net'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export interface MockOptions {
  token: string
  /** Listen on this port (default: a free one). */
  port?: number
  menus?: { name: string; swf: string; open: boolean }[]
  runtimeVersionString?: string
  runtimeVersion?: number
  protocolVersion?: number
  /** What the runtime reports as its spec version (default: the editor's, from the hello). */
  specVersion?: number
  gameVersion?: string
  /** Application-level `ping {id}` every N ms (0 = never). */
  pingEveryMs?: number
  /** Close a connection that has not said hello after N ms (the real server: 5000). */
  handshakeMs?: number
  /** `reloadAck` for a reload request: default ok, every requested (or every known) menu reloaded. */
  reload?: (menu: string | undefined) => { ok: boolean; reloaded: string[]; skipped?: { name: string; reason: string }[]; ms?: number; error?: string }
  /** Do not answer `reload` at all (timeout test). */
  silentReload?: boolean
}

export interface MockConn {
  headers: Record<string, string>
  requestLine: string
  hello?: Record<string, unknown>
}

const frame = (op: number, payload: Buffer): Buffer => {
  const n = payload.length
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => {
    const h = Buffer.alloc(10)
    h[0] = 0x80 | op
    h[1] = 127
    h.writeBigUInt64BE(BigInt(n), 2)
    return h
  })()
  return Buffer.concat([head, payload])
}

export async function startMockRuntime(o: MockOptions) {
  const received: Record<string, unknown>[] = []
  const connections: MockConn[] = []
  const subs = new Map<string, { watch: boolean; pins: boolean }>()
  let primary: net.Socket | undefined
  let failed = 0
  const menus = o.menus ?? [{ name: 'InkwellTest_Menu', swf: 'Interface/Inkwell/Test/menu.swf', open: false }]
  const sockets = new Set<net.Socket>()
  let pingId = 0
  let pingTimer: NodeJS.Timeout | undefined

  const sendTo = (s: net.Socket, obj: unknown): void => void s.write(frame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))))
  const closeWith = (s: net.Socket, code: number): void => {
    const b = Buffer.alloc(2)
    b.writeUInt16BE(code)
    s.write(frame(8, b))
    s.end()
  }

  const server = net.createServer((sock) => {
    sockets.add(sock)
    sock.on('close', () => {
      sockets.delete(sock)
      if (primary === sock) primary = undefined
    })
    sock.on('error', () => undefined)
    let buf = Buffer.alloc(0)
    let upgraded = false
    let conn: MockConn | undefined
    let handshakeTimer: NodeJS.Timeout | undefined
    const onFrame = (op: number, payload: Buffer): void => {
      if (op === 8) return void sock.end()
      if (op === 9) return void sock.write(frame(10, payload))
      if (op !== 1) return
      let m: Record<string, unknown>
      try {
        m = JSON.parse(payload.toString('utf8')) as Record<string, unknown>
      } catch {
        sendTo(sock, { type: 'error', code: 'bad-message', message: 'not JSON' })
        return closeWith(sock, 1008)
      }
      received.push(m)
      if (!conn) return
      if (!conn.hello) {
        if (m['type'] !== 'hello') {
          sendTo(sock, { type: 'error', code: 'bad-message', message: 'hello first' })
          return closeWith(sock, 1008)
        }
        conn.hello = m
        clearTimeout(handshakeTimer)
        const ack = (extra: object) => ({ type: 'helloAck', runtimeVersion: o.runtimeVersion ?? 196608, runtimeVersionString: o.runtimeVersionString ?? '0.3.0', protocolVersion: o.protocolVersion ?? 1, specVersion: o.specVersion ?? Number(m['specVersion']), gameVersion: o.gameVersion ?? '1.6.1170', ...extra })
        const given = Buffer.from(String(m['token'] ?? ''))
        const want = Buffer.from(o.token)
        const tokenOk = given.length === want.length && timingSafeEqual(given, want)
        if (!tokenOk) {
          failed++
          sendTo(sock, ack({ ok: false, error: 'unauthorized', menus: [] }))
          return closeWith(sock, 1008)
        }
        if (m['protocolVersion'] !== (o.protocolVersion ?? 1)) {
          sendTo(sock, ack({ ok: false, error: 'protocol-mismatch', menus: [] }))
          return closeWith(sock, 1008)
        }
        if (primary && primary !== sock) {
          sendTo(sock, { type: 'error', code: 'busy', message: 'another editor is connected' })
          return closeWith(sock, 1008)
        }
        primary = sock
        return sendTo(sock, ack({ ok: true, menus }))
      }
      switch (m['type']) {
        case 'ping':
          return sendTo(sock, { type: 'pong', ...(m['id'] !== undefined ? { id: m['id'] } : {}) })
        case 'subscribe':
          if (!menus.some((x) => x.name === m['menu']) && !extraMenus.has(String(m['menu']))) return sendTo(sock, { type: 'error', code: 'unknown-menu', message: `no menu ${String(m['menu'])}` })
          subs.set(String(m['menu']), { watch: m['watch'] === true, pins: m['pins'] === true })
          return
        case 'unsubscribe':
          return void subs.delete(String(m['menu']))
        case 'reload': {
          if (o.silentReload) return
          const menu = m['menu'] as string | undefined
          const r = o.reload ? o.reload(menu) : menu && !menus.some((x) => x.name === menu) ? { ok: false, reloaded: [], error: `unknown menu ${menu}` } : { ok: true, reloaded: menu ? [menu] : menus.map((x) => x.name) }
          if (!r.ok && menu && !menus.some((x) => x.name === menu)) sendTo(sock, { type: 'error', code: 'unknown-menu', message: r.error ?? '', id: m['id'] })
          return sendTo(sock, { type: 'reloadAck', id: m['id'], ok: r.ok, reloaded: r.reloaded, skipped: r.skipped ?? [], ms: r.ms ?? 42, ...(r.error ? { error: r.error } : {}) })
        }
      }
    }
    const pump = (): void => {
      for (;;) {
        if (buf.length < 2) return
        const op = buf[0]! & 15
        const masked = (buf[1]! & 128) !== 0
        let len = buf[1]! & 127
        let off = 2
        if (len === 126) {
          if (buf.length < 4) return
          len = buf.readUInt16BE(2)
          off = 4
        } else if (len === 127) {
          if (buf.length < 10) return
          len = Number(buf.readBigUInt64BE(2))
          off = 10
        }
        if (!masked) return void sock.destroy() // RFC 6455: a client frame must be masked
        if (buf.length < off + 4 + len) return
        const mask = buf.subarray(off, off + 4)
        const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len))
        for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i & 3]!
        buf = buf.subarray(off + 4 + len)
        onFrame(op, payload)
      }
    }
    sock.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n')
        if (end < 0) return
        const lines = buf.subarray(0, end).toString('latin1').split('\r\n')
        buf = buf.subarray(end + 4)
        const headers: Record<string, string> = {}
        for (const l of lines.slice(1)) {
          const i = l.indexOf(':')
          if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim()
        }
        conn = { headers, requestLine: lines[0]! }
        connections.push(conn)
        const port = (server.address() as net.AddressInfo).port
        const hostOk = headers['host'] === `127.0.0.1:${port}` || headers['host'] === `localhost:${port}`
        if (headers['origin'] !== undefined || !hostOk || !headers['sec-websocket-key'] || headers['upgrade']?.toLowerCase() !== 'websocket') {
          sock.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
          return void sock.end()
        }
        const accept = createHash('sha1').update(headers['sec-websocket-key'] + GUID).digest('base64')
        sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
        upgraded = true
        handshakeTimer = setTimeout(() => closeWith(sock, 1008), o.handshakeMs ?? 5000)
        handshakeTimer.unref()
      }
      pump()
    })
  })
  const extraMenus = new Set<string>()
  await new Promise<void>((r) => server.listen(o.port ?? 0, '127.0.0.1', r))
  const port = (server.address() as net.AddressInfo).port
  if (o.pingEveryMs) pingTimer = setInterval(() => primary && sendTo(primary, { type: 'ping', id: ++pingId }), o.pingEveryMs)

  return {
    port,
    received,
    connections,
    subs,
    get failedTokens(): number { return failed },
    get connected(): boolean { return !!primary },
    /** Sends one message (an object, or a raw string for malformed input) to the connected editor. */
    send: (m: unknown): void => void (primary && sendTo(primary, m)),
    /** Raw bytes to the editor (malformed frames). */
    sendBytes: (b: Buffer): void => void primary?.write(b),
    /** A menu that exists although it was not in the hello (registered by a hot reload). */
    addMenu: (name: string): void => void extraMenus.add(name),
    /** Kills the connection without a close frame, like the game exiting. */
    drop: (): void => void primary?.destroy(),
    /** Runtime-initiated close with a code. */
    closeClient: (code = 1000): void => void (primary && closeWith(primary, code)),
    waitFor: async (pred: () => boolean, ms = 3000): Promise<void> => {
      const t0 = Date.now()
      while (!pred()) {
        if (Date.now() - t0 > ms) throw new Error('timed out waiting for the mock runtime')
        await new Promise((r) => setTimeout(r, 5))
      }
    },
    close: async (): Promise<void> => {
      clearInterval(pingTimer)
      for (const s of sockets) s.destroy()
      await new Promise<void>((r) => server.close(() => r()))
    }
  }
}
export type MockRuntime = Awaited<ReturnType<typeof startMockRuntime>>
