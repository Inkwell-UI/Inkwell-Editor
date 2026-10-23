import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { hashNode, PROTOCOL_VERSION, SPEC_VERSION, type Swf } from '@inkwell-ui/spec'
import { frame, rectShape, swf } from '../swf/ir.testutil'
import { startSyncServer, type SyncServerOptions } from './syncServer'

type Server = Awaited<ReturnType<typeof startSyncServer>>
const open: Server[] = []
const clients: WebSocket[] = []
afterEach(async () => {
  clients.splice(0).forEach((c) => c.terminate())
  await Promise.all(open.splice(0).map((s) => s.close()))
})

const start = async (o: Partial<SyncServerOptions> = {}): Promise<Server> => {
  const s = await startSyncServer({ editorVersion: '0.0.1', ports: [0], debounceMs: 20, ...o })
  open.push(s)
  return s
}
const connect = (s: Server, o: { token?: string; origin?: string } = {}) =>
  new Promise<{ ws: WebSocket; next: () => Promise<any> }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/?token=${o.token ?? s.token}`, { headers: o.origin ? { Origin: o.origin } : {} })
    clients.push(ws)
    const msgs: any[] = []
    const waiters: ((m: any) => void)[] = []
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      const w = waiters.shift()
      if (w) w(m)
      else msgs.push(m)
    })
    const next = () => new Promise<any>((r) => (msgs.length ? r(msgs.shift()) : waiters.push(r)))
    ws.on('open', () => resolve({ ws, next }))
    ws.on('unexpected-response', (_q, res) => reject(new Error(`HTTP ${res.statusCode}`)))
    ws.on('error', () => {})
  })
const hello = (over: object = {}) => ({ type: 'hello', pluginVersion: '0.0.1', protocolVersion: PROTOCOL_VERSION, specVersion: SPEC_VERSION, ...over })
const ready = async (s: Server) => {
  const c = await connect(s)
  c.ws.send(JSON.stringify(hello()))
  expect((await c.next()).ok).toBe(true)
  return c
}
const sample = (): Swf => swf([frame('f', ['s']), rectShape('s')])
const patchUpsert = (node: unknown) => ({ type: 'patch', seq: 1, patch: { ops: [{ op: 'upsert', node }] } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('syncServer', () => {
  it('rejects a bad token (401) and a bad origin (403); accepts the null origin', async () => {
    const s = await start()
    await expect(connect(s, { token: 'x'.repeat(48) })).rejects.toThrow('401')
    await expect(connect(s, { token: '' })).rejects.toThrow('401')
    await expect(connect(s, { origin: 'https://evil.example' })).rejects.toThrow('403')
    await connect(s, { origin: 'null' })
    expect(s.token).toMatch(/^[0-9a-f]{48}$/)
  })

  it('binds to loopback only', async () => {
    const s = await start()
    const addr = await new Promise<string>((resolve) => {
      const sock = net.connect(s.port, '127.0.0.1', () => {
        resolve(sock.remoteAddress!)
        sock.end()
      })
    })
    expect(addr).toBe('127.0.0.1')
    // a listener on 0.0.0.0 would also answer on the machine's other addresses; check the non-loopback IPv4 ones refuse
    const { networkInterfaces } = await import('node:os')
    const others = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal)
    for (const i of others)
      await expect(new Promise((res, rej) => net.connect(s.port, i!.address).on('connect', res).on('error', rej))).rejects.toBeTruthy()
  })

  it('takes the next free port when the first is taken', async () => {
    const a = await start()
    const b = await start({ ports: [a.port, 0] })
    expect(b.port).not.toBe(a.port)
  })

  it('hello ok, and version mismatch gives a clear error and closes', async () => {
    const s = await start()
    await ready(s)
    expect(s.connections()).toBe(1)
    const bad = await connect(s)
    const closed = new Promise((r) => bad.ws.on('close', r))
    bad.ws.send(JSON.stringify(hello({ protocolVersion: PROTOCOL_VERSION + 1 })))
    const ack = await bad.next()
    expect(ack.ok).toBe(false)
    expect(ack.error).toMatch(/Protocol mismatch/)
    await closed
  })

  it('patch is applied and onChange runs once after the debounce', async () => {
    const onChange = vi.fn()
    const s = await start({ initial: { hud: sample() }, onChange })
    const c = await ready(s)
    const node = { ...s.ir().nodes['s'], opacity: 0.5, extra: { keep: 1 } }
    c.ws.send(JSON.stringify(patchUpsert(node)))
    c.ws.send(JSON.stringify(patchUpsert({ ...node, opacity: 0.25 })))
    await sleep(150)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toBe('hud')
    expect(s.ir().nodes['s']).toMatchObject({ opacity: 0.25, extra: { keep: 1 } })
  })

  it('empty store: the first patch builds the IR and picks the root', async () => {
    const s = await start()
    const c = await ready(s)
    c.ws.send(JSON.stringify(patchUpsert(frame('f', []))))
    await sleep(60)
    expect(s.ir().root).toBe('f')
    expect(s.swfId).toBe('main')
  })

  it('PatchError becomes an error message with the node id and the store is unchanged', async () => {
    const onChange = vi.fn()
    const s = await start({ initial: { hud: sample() }, onChange })
    const c = await ready(s)
    const before = s.ir()
    c.ws.send(JSON.stringify({ type: 'patch', seq: 2, patch: { ops: [{ op: 'move', id: 'nope', parent: 'f' }] } }))
    expect(await c.next()).toMatchObject({ type: 'error', code: 'unknown_node', nodeId: 'nope' })
    expect(s.ir()).toBe(before)
    await sleep(60)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hashTree: mismatched and missing nodes are resent, matching ones are not', async () => {
    const s = await start({ initial: { hud: sample() } })
    const c = await ready(s)
    const n = s.ir().nodes
    c.ws.send(JSON.stringify({ type: 'hashTree', nodeHashes: { f: hashNode(n['f']), s: 'deadbeef', gone: '00000000' } }))
    const r = await c.next()
    expect(r.type).toBe('resend')
    expect([...r.ids].sort()).toEqual(['gone', 's'])
  })

  it('malformed JSON and unknown messages yield error and keep the socket', async () => {
    const s = await start()
    const c = await ready(s)
    c.ws.send('{nope')
    expect((await c.next()).code).toBe('bad_json')
    c.ws.send(JSON.stringify({ type: 'wat' }))
    expect((await c.next()).code).toBe('invalid_message')
    c.ws.send(JSON.stringify({ type: 'patch', seq: 1, patch: { ops: [{ op: 'upsert', node: { id: 1 } }] } }))
    expect((await c.next()).code).toBe('invalid_message')
    expect(c.ws.readyState).toBe(WebSocket.OPEN)
  })

  it('remembers the selection and emits it', async () => {
    const s = await start()
    const got = new Promise((r) => s.events.once('selection', r))
    const c = await ready(s)
    c.ws.send(JSON.stringify({ type: 'selection', ids: ['1:2'] }))
    expect(await got).toEqual(['1:2'])
    expect(s.selection()).toEqual(['1:2'])
  })

  it('status goes compiling -> synced with issues; a throwing hook gives error', async () => {
    let fail = false
    const s = await start({
      initial: { hud: sample() },
      onChange: async () => {
        if (fail) throw new Error('FFDec not found')
        return { issues: [{ code: 'w', message: 'warn', nodeId: 's' }] }
      }
    })
    const c = await ready(s)
    c.ws.send(JSON.stringify(patchUpsert({ ...s.ir().nodes['s'], opacity: 0.1 })))
    expect(await c.next()).toEqual({ type: 'status', state: 'compiling' })
    expect(await c.next()).toMatchObject({ type: 'status', state: 'synced', issues: [{ code: 'w' }] })
    fail = true
    c.ws.send(JSON.stringify(patchUpsert({ ...s.ir().nodes['s'], opacity: 0.2 })))
    expect((await c.next()).state).toBe('compiling')
    expect(await c.next()).toMatchObject({ state: 'error', issues: [{ message: 'FFDec not found' }] })
  })
})
