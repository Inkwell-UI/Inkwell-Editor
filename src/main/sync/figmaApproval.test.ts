import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { PROTOCOL_VERSION, SPEC_VERSION } from '@inkwell-ui/spec'
import { loadSettings, saveSettings } from '../settings'
import { createTrust, hashSecret, PROMPT_GAP_MS, type ApprovalRequest, type TrustStore } from './figmaTrust'
import { PENDING_TIMEOUT_MS, startSyncServer } from './syncServer'

type Server = Awaited<ReturnType<typeof startSyncServer>>
const servers: Server[] = []
const sockets: WebSocket[] = []
afterEach(async () => {
  vi.useRealTimers()
  sockets.splice(0).forEach((c) => c.terminate())
  await Promise.all(servers.splice(0).map((s) => s.close()))
})

const SECRET = '12'.repeat(32)
const OTHER = '34'.repeat(32)
const memStore = (initial: string[] = []): TrustStore & { list: string[] } => {
  const list = [...initial]
  return { list, hashes: () => list, add: async (h) => void list.push(h) }
}
/** A prompt the test answers by hand: `prompts` lists the open ones. */
function prompter() {
  const prompts: { req: ApprovalRequest; signal: AbortSignal; answer(allow: boolean): void }[] = []
  const ask = (req: ApprovalRequest, signal: AbortSignal) =>
    new Promise<boolean>((resolve) => {
      prompts.push({ req, signal, answer: resolve })
      signal.addEventListener('abort', () => resolve(false))
    })
  return { prompts, ask }
}
const start = async (trust: ReturnType<typeof createTrust>): Promise<Server> => {
  const s = await startSyncServer({ editorVersion: '0.0.1', ports: [0], debounceMs: 20, trust })
  servers.push(s)
  return s
}
interface Client {
  ws: WebSocket
  msgs: any[]
  closed: Promise<number>
  waitFor(n: number): Promise<void>
}
const connect = (s: Server, headers: Record<string, string> = {}) =>
  new Promise<Client>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/`, { headers })
    sockets.push(ws)
    const msgs: any[] = []
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())))
    const closed = new Promise<number>((r) => ws.on('close', r))
    ws.on('open', () => resolve({ ws, msgs, closed, waitFor: async (n) => void (await vi.waitFor(() => expect(msgs.length).toBeGreaterThanOrEqual(n))) }))
    ws.on('unexpected-response', (_q, res) => reject(new Error(`HTTP ${res.statusCode}`)))
    ws.on('error', () => {})
  })
/** vi.waitFor advances fake timers by itself, which would fire the 60 s timeout early; this only lets the event loop turn. */
const spin = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 5000 && !cond(); i++) await new Promise((r) => setImmediate(r))
  expect(cond()).toBe(true)
}
const hello = (secret = SECRET) =>
  JSON.stringify({ type: 'hello', pluginVersion: '1.2.3', protocolVersion: PROTOCOL_VERSION, specVersion: SPEC_VERSION, pluginSecret: secret, fileName: 'My HUD', fileKey: 'K' })
const patch = JSON.stringify({ type: 'patch', seq: 1, swfId: 'hud', swf: { id: 'hud', name: 'Hud', stage: { width: 10, height: 10 } }, patch: { ops: [] } })

describe('Figma approval (protocol 4)', () => {
  it('unknown secret: pending, the prompt shows version, file and origin, Allow gives helloAck and stores only the hash', async () => {
    const store = memStore()
    const p = prompter()
    const s = await start(createTrust({ store, ask: p.ask }))
    const c = await connect(s, { Origin: 'null' })
    c.ws.send(hello())
    await c.waitFor(1)
    expect(c.msgs[0]).toEqual({ type: 'pending' })
    expect(p.prompts).toHaveLength(1)
    expect(p.prompts[0]!.req).toEqual({ pluginVersion: '1.2.3', fileName: 'My HUD', origin: 'null' })
    expect(s.connections()).toBe(0)
    p.prompts[0]!.answer(true)
    await c.waitFor(2)
    expect(c.msgs[1]).toMatchObject({ type: 'helloAck', ok: true })
    expect(s.connections()).toBe(1)
    expect(store.list).toEqual([hashSecret(SECRET)])
    expect(JSON.stringify(store.list)).not.toContain(SECRET)
    // now an ordinary patch is accepted
    c.ws.send(patch)
    await vi.waitFor(() => expect(s.swfs()).toHaveLength(1))
  })

  it('a pending socket can send nothing else: patches are not applied and the socket is closed', async () => {
    const p = prompter()
    const s = await start(createTrust({ store: memStore(), ask: p.ask }))
    const c = await connect(s)
    c.ws.send(hello())
    await c.waitFor(1)
    c.ws.send(patch)
    await c.closed
    expect(s.swfs()).toHaveLength(0)
    expect(p.prompts[0]!.signal.aborted).toBe(true) // the prompt is withdrawn
    expect(c.msgs.filter((m) => m.type === 'helloAck')).toHaveLength(0)
  })

  it('Deny: denied, the socket closes, and the secret is refused for the rest of the session without asking again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }) // let a minute pass without waiting
    const p = prompter()
    const s = await start(createTrust({ store: memStore(), ask: p.ask }))
    const c = await connect(s)
    c.ws.send(hello())
    await c.waitFor(1)
    p.prompts[0]!.answer(false)
    await c.closed
    expect(c.msgs[1]).toEqual({ type: 'denied', reason: 'denied' })
    vi.setSystemTime(Date.now() + PROMPT_GAP_MS + 1)
    const again = await connect(s)
    again.ws.send(hello())
    await again.closed
    expect(again.msgs).toEqual([{ type: 'denied', reason: 'denied' }])
    expect(p.prompts).toHaveLength(1)
  })

  it('times out after 60 s: denied {timeout}, closed, the prompt withdrawn, and the secret is not blacklisted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const p = prompter()
    const store = memStore()
    const s = await start(createTrust({ store, ask: p.ask }))
    const c = await connect(s)
    c.ws.send(hello())
    await spin(() => c.msgs.length === 1)
    await vi.advanceTimersByTimeAsync(PENDING_TIMEOUT_MS - 1)
    expect(c.ws.readyState).toBe(WebSocket.OPEN)
    await vi.advanceTimersByTimeAsync(2)
    await spin(() => c.ws.readyState === WebSocket.CLOSED)
    expect(c.msgs[1]).toEqual({ type: 'denied', reason: 'timeout' })
    expect(p.prompts[0]!.signal.aborted).toBe(true)
    expect(store.list).toEqual([])
    // a minute after the first prompt started, the same plugin may ask again
    const c2 = await connect(s)
    c2.ws.send(hello())
    await spin(() => c2.msgs.length === 1)
    expect(c2.msgs[0]).toEqual({ type: 'pending' })
  })

  it('one prompt at a time and at most one per minute: others get denied {busy}', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const p = prompter()
    const s = await start(createTrust({ store: memStore(), ask: p.ask }))
    const a = await connect(s)
    a.ws.send(hello(SECRET))
    await a.waitFor(1)
    const b = await connect(s) // while the first prompt is open
    b.ws.send(hello(OTHER))
    await b.closed
    expect(b.msgs).toEqual([{ type: 'denied', reason: 'busy' }])
    p.prompts[0]!.answer(true)
    await a.waitFor(2)
    const c = await connect(s) // the first prompt is answered, but it started less than a minute ago
    c.ws.send(hello(OTHER))
    await c.closed
    expect(c.msgs).toEqual([{ type: 'denied', reason: 'busy' }])
    expect(p.prompts).toHaveLength(1)
    vi.setSystemTime(Date.now() + PROMPT_GAP_MS + 1)
    const d = await connect(s)
    d.ws.send(hello(OTHER))
    await d.waitFor(1)
    expect(d.msgs[0]).toEqual({ type: 'pending' })
    expect(p.prompts).toHaveLength(2)
  })

  it('an approved secret survives a restart (settings file) and skips the prompt; the file never holds the secret', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'inkwell-trust-')), 'settings.json')
    let cur: string[] = []
    const fileStore: TrustStore = {
      hashes: () => cur,
      add: async (h) => {
        cur = [...cur, h]
        await saveSettings(file, { figmaPlugins: cur })
      }
    }
    const p = prompter()
    const s1 = await start(createTrust({ store: fileStore, ask: p.ask }))
    const c1 = await connect(s1)
    c1.ws.send(hello())
    await c1.waitFor(1)
    p.prompts[0]!.answer(true)
    await c1.waitFor(2)
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(raw).toContain(hashSecret(SECRET))
    // "restart": a new trust over the reloaded file; asking would fail the test
    const loaded = (await loadSettings(file)).figmaPlugins ?? []
    const ask = vi.fn(async () => false)
    const s2 = await start(createTrust({ store: { hashes: () => loaded, add: async () => {} }, ask }))
    const c2 = await connect(s2)
    c2.ws.send(hello())
    await c2.waitFor(1)
    expect(c2.msgs[0]).toMatchObject({ type: 'helloAck', ok: true })
    expect(ask).not.toHaveBeenCalled()
  })

  it('a wrong origin is still refused with 403 before any hello', async () => {
    const s = await start(createTrust({ store: memStore([hashSecret(SECRET)]), ask: async () => true }))
    await expect(connect(s, { Origin: 'https://evil.example' })).rejects.toThrow('403')
  })

  it('a protocol 3 plugin (no secret) is told to update instead of being prompted', async () => {
    const ask = vi.fn(async () => true)
    const s = await start(createTrust({ store: memStore(), ask }))
    const c = await connect(s)
    c.ws.send(JSON.stringify({ type: 'hello', pluginVersion: '0.1', protocolVersion: 3, specVersion: SPEC_VERSION }))
    await c.closed
    expect(c.msgs[0]).toMatchObject({ type: 'helloAck', ok: false })
    expect(c.msgs[0].error).toMatch(/Update the plugin/)
    expect(ask).not.toHaveBeenCalled()
  })

  it('dropAll disconnects approved plugins (Forget all)', async () => {
    const s = await start(createTrust({ store: memStore([hashSecret(SECRET)]), ask: async () => false }))
    const c = await connect(s)
    c.ws.send(hello())
    await c.waitFor(1)
    s.dropAll()
    await c.closed
    expect(s.connections()).toBe(0)
  })
})
