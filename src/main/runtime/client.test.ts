// The editor's dev client against the mock runtime (engine-free, hand-written RFC 6455 server on node:net). The real game was not involved.
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { SPEC_VERSION } from '@inkwell-ui/spec'
import type { DevEvent } from '../../shared/devLink'
import { createDevClient, type ClientState, type DevClientOptions, type DevConfig } from './client'
import { startMockRuntime, type MockRuntime } from './mockRuntime.testutil'

const TOKEN = 'ab'.repeat(32)
const FAST = { retry: { initialMs: 15, maxMs: 40, slowMs: 40 }, flushMs: 5, handshakeMs: 1500 }
const cleanup: (() => unknown)[] = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

async function rig(target: { port: number }, extra: Partial<DevClientOptions> = {}, token = TOKEN) {
  const states: ClientState[] = []
  const events: DevEvent[] = []
  let config: DevConfig | undefined = { token, port: target.port, source: 'editor' }
  const client = createDevClient({
    editorVersion: '0.1.0-test', resolveConfig: () => config, onState: (s) => states.push(s), onEvents: (e) => events.push(...e), ...FAST, ...extra
  })
  cleanup.push(() => client.stop())
  const phase = (): string | undefined => states.at(-1)?.phase
  const until = async (p: () => boolean, ms = 3000): Promise<void> => {
    const t0 = Date.now()
    while (!p()) {
      if (Date.now() - t0 > ms) throw new Error(`timed out; phases so far: ${states.map((s) => s.phase).join(' > ')}`)
      await new Promise((r) => setTimeout(r, 5))
    }
  }
  return { client, states, events, phase, until, setConfig: (c: DevConfig | undefined) => void (config = c) }
}
const mock = async (o: Partial<Parameters<typeof startMockRuntime>[0]> = {}): Promise<MockRuntime> => {
  const m = await startMockRuntime({ token: TOKEN, ...o })
  cleanup.push(() => m.close())
  return m
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('handshake', () => {
  it('connects with no Origin header and Host 127.0.0.1:<port>, hello first with token and versions, then subscribes to the menus', async () => {
    const m = await mock()
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    const c = m.connections[0]!
    expect(c.headers['origin']).toBeUndefined()
    expect(c.headers['host']).toBe(`127.0.0.1:${m.port}`)
    expect(m.received[0]).toMatchObject({ type: 'hello', token: TOKEN, editorVersion: '0.1.0-test', protocolVersion: 1, specVersion: SPEC_VERSION })
    const s = r.states.at(-1)!
    expect(s.runtime).toMatchObject({ versionString: '0.3.0', gameVersion: '1.6.1170', protocol: 1 })
    expect(s.menus).toEqual([{ name: 'InkwellTest_Menu', swf: 'Interface/Inkwell/Test/menu.swf', open: false }])
    await m.waitFor(() => m.subs.has('InkwellTest_Menu'))
    expect(m.subs.get('InkwellTest_Menu')).toEqual({ watch: true, pins: true })
    expect(s.specMismatch).toBe(false)
    expect(s.session).toBe(1)
  })
  it('the mock itself refuses an Origin header and a foreign Host, like the runtime (so the test above means something)', async () => {
    const m = await mock()
    const status = (opts: WebSocket.ClientOptions): Promise<number> =>
      new Promise((res) => {
        const ws = new WebSocket(`ws://127.0.0.1:${m.port}/`, opts)
        ws.on('unexpected-response', (_q, r) => res(r.statusCode ?? 0))
        ws.on('open', () => {
          ws.close()
          res(101)
        })
        ws.on('error', () => undefined)
      })
    expect(await status({ origin: 'http://evil.example' })).toBe(403)
    expect(await status({ headers: { Host: 'evil.example' } })).toBe(403)
    expect(await status({})).toBe(101)
  })
  it('a wrong token is unauthorized and is NOT retried (five bad tokens lock the server for a minute)', async () => {
    const m = await mock()
    const r = await rig(m, {}, 'cd'.repeat(32))
    r.client.start()
    await r.until(() => r.phase() === 'unauthorized')
    expect(r.states.at(-1)!.message).toMatch(/refused the token/)
    await sleep(250) // many retry periods
    expect(m.connections).toHaveLength(1)
    expect(m.failedTokens).toBe(1)
    // a new token (paste) tries again at once
    r.setConfig({ token: TOKEN, port: m.port, source: 'pasted' })
    r.client.configChanged()
    await r.until(() => r.phase() === 'connected')
    expect(r.states.at(-1)!.tokenSource).toBe('pasted')
  })
  it('a protocol mismatch is shown as such and not retried', async () => {
    const m = await mock({ protocolVersion: 2 })
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'protocolMismatch')
    expect(r.states.at(-1)!.message).toMatch(/protocol/)
    await sleep(150)
    expect(m.connections).toHaveLength(1)
  })
  it('a spec version difference still connects, amber', async () => {
    const m = await mock({ specVersion: 99 })
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    expect(r.states.at(-1)).toMatchObject({ specMismatch: true })
    expect(r.states.at(-1)!.message).toMatch(/99/)
  })
  it('a second editor gets busy and keeps retrying slowly; it gets in when the first leaves', async () => {
    const m = await mock()
    const a = await rig(m)
    const b = await rig(m)
    a.client.start()
    await a.until(() => a.phase() === 'connected')
    b.client.start()
    await b.until(() => b.phase() === 'busy')
    expect(b.states.at(-1)!.message).toMatch(/Another editor/)
    a.client.stop()
    await b.until(() => b.phase() === 'connected')
  })
  it('nothing listening: waiting (quiet retries); connects when the game starts', async () => {
    const probe = await mock()
    const port = probe.port
    await probe.close()
    const r = await rig({ port })
    r.client.start()
    await r.until(() => r.phase() === 'waiting')
    await sleep(100)
    expect(r.states.map((s) => s.phase)).not.toContain('connecting') // no amber flicker while the game is off
    await mock({ port })
    await r.until(() => r.phase() === 'connected')
  })
  it('no token known: noToken, and it connects after the config appears', async () => {
    const m = await mock()
    const r = await rig(m)
    r.setConfig(undefined)
    r.client.start()
    await r.until(() => r.phase() === 'noToken')
    expect(r.states.at(-1)!.message).toMatch(/Dev deploy|paste/i)
    r.setConfig({ token: TOKEN, port: m.port, source: 'overwrite', from: 'x' })
    await r.until(() => r.phase() === 'connected') // the slow retry re-reads the config
    expect(r.states.at(-1)).toMatchObject({ tokenSource: 'overwrite', tokenFrom: 'x' })
  })
  it('the token never appears in the state or the events, only masked', async () => {
    const m = await mock()
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    m.send({ type: 'trace', ts: 1, level: 'info', source: 'as2', text: 'hello' })
    await r.until(() => r.events.length > 0)
    expect(JSON.stringify([r.states, r.events])).not.toContain(TOKEN)
    expect(r.states.at(-1)!.tokenMasked).toBe('abab...abab')
  })
  it('Disconnect closes and stops retrying; Connect starts again', async () => {
    const m = await mock()
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    r.client.stop()
    expect(r.phase()).toBe('off')
    await m.waitFor(() => !m.connected)
    await sleep(100)
    expect(m.connections).toHaveLength(1)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
  })
})

describe('session', () => {
  it('answers every runtime ping with the same id', async () => {
    const m = await mock({ pingEveryMs: 15 })
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    await m.waitFor(() => m.received.filter((x) => x['type'] === 'pong').length >= 3)
    const pongs = m.received.filter((x) => x['type'] === 'pong').map((x) => x['id'])
    expect(pongs.slice(0, 3)).toEqual([1, 2, 3])
  })
  it('reconnects with backoff after the game goes away and subscribes again (subscriptions do not survive)', async () => {
    const m = await mock()
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    await m.waitFor(() => m.subs.size === 1)
    m.subs.clear()
    m.drop()
    await r.until(() => r.phase() === 'waiting')
    await r.until(() => r.phase() === 'connected' && r.states.at(-1)!.session === 2)
    await m.waitFor(() => m.subs.has('InkwellTest_Menu'))
    expect(m.connections).toHaveLength(2)
  })
  it('a connection that goes silent is dropped by the idle watchdog and re-established', async () => {
    const m = await mock()
    const r = await rig(m, { idleMs: 120 })
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    await r.until(() => m.connections.length === 2 && r.phase() === 'connected', 3000)
  })
  it('menuState updates the menu list; a menu that appears later is subscribed', async () => {
    const m = await mock()
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    m.addMenu('InkwellTest_New')
    m.send({ type: 'menuState', menu: 'InkwellTest_Menu', open: true })
    m.send({ type: 'menuState', menu: 'InkwellTest_New', open: false })
    await r.until(() => r.states.at(-1)!.menus.length === 2)
    expect(r.states.at(-1)!.menus.find((x) => x.name === 'InkwellTest_Menu')!.open).toBe(true)
    await m.waitFor(() => m.subs.has('InkwellTest_New'))
  })
})

describe('streams', () => {
  it('trace lines arrive with level, source, menu, node and text', async () => {
    const m = await mock()
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    m.send({ type: 'trace', ts: 1234, level: 'warn', source: 'as2', menu: 'InkwellTest_Menu', node: 'n7', text: 'coerced', extraKey: 1 })
    await r.until(() => r.events.some((e) => e.k === 'trace'))
    expect(r.events.find((e) => e.k === 'trace')).toMatchObject({ ts: 1234, level: 'warn', source: 'as2', menu: 'InkwellTest_Menu', node: 'n7', text: 'coerced' })
  })
  it('pins and watch values are lossy: a burst on one pin delivers its latest value', async () => {
    const m = await mock()
    const r = await rig(m, { flushMs: 40 })
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    for (let i = 0; i < 100; i++) m.send({ type: 'pin', menu: 'M', node: 'n1', pin: 'value', value: i })
    m.send({ type: 'pin', menu: 'M', node: 'n2', pin: 'value', value: 'x' })
    for (let i = 0; i < 20; i++) m.send({ type: 'watch', menu: 'M', graph: 'g', scope: 'menu', name: 'score', value: i })
    await r.until(() => r.events.some((e) => e.k === 'watch') && r.events.filter((e) => e.k === 'pin').length >= 2)
    await sleep(100)
    const pins = r.events.filter((e) => e.k === 'pin')
    expect(pins.length).toBeLessThan(100)
    expect(pins.filter((e) => e.k === 'pin' && e.node === 'n1').at(-1)).toMatchObject({ value: 99 })
    expect(r.events.filter((e) => e.k === 'watch').at(-1)).toMatchObject({ name: 'score', value: 19 })
  })
  it('malformed or unknown server messages are ignored and the connection stays up', async () => {
    const m = await mock()
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    m.send('this is not json')
    m.send({ type: 'somethingNew', a: 1 })
    m.send({ type: 'trace', ts: 'late', level: 'info', source: 'as2', text: 5 }) // known type, wrong shape
    m.send({ nothing: true })
    m.send('[1,2]')
    m.send({ type: 'trace', ts: 2, level: 'info', source: 'runtime', text: 'still alive', unknownKey: { a: 1 } })
    await r.until(() => r.events.some((e) => e.k === 'trace'))
    expect(r.events.filter((e) => e.k === 'trace')).toHaveLength(1)
    expect(r.phase()).toBe('connected')
    expect(m.connections).toHaveLength(1)
  })
  it('a protocol-level violation (reserved opcode) drops the socket and the client reconnects', async () => {
    const m = await mock()
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    m.sendBytes(Buffer.from([0x83, 0x00])) // opcode 3 is reserved
    await r.until(() => m.connections.length === 2 && r.phase() === 'connected')
  })
  it('an oversize frame is refused by the size limit and does not crash', async () => {
    const m = await mock()
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    const head = Buffer.alloc(10)
    head[0] = 0x81
    head[1] = 127
    head.writeBigUInt64BE(BigInt(2 * 1024 * 1024), 2)
    m.sendBytes(head) // announces 2 MiB; the limit is 1 MiB
    await r.until(() => m.connections.length === 2 && r.phase() === 'connected')
  })
  it('an error message from the runtime is an event, not a state change', async () => {
    const m = await mock()
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    m.send({ type: 'error', code: 'unknown-menu', message: 'no menu X' })
    await r.until(() => r.events.some((e) => e.k === 'error'))
    expect(r.events.find((e) => e.k === 'error')).toMatchObject({ code: 'unknown-menu', message: 'no menu X' })
    expect(r.phase()).toBe('connected')
  })
})

describe('reload', () => {
  it('sends reload {id, menu} and resolves with the ack (ms, reloaded, skipped); the reloaded menu is subscribed again for a fresh dump', async () => {
    const m = await mock({ reload: (menu) => ({ ok: true, reloaded: menu ? [menu] : [], skipped: [{ name: 'Other', reason: 'unchanged' }], ms: 137 }) })
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    await m.waitFor(() => m.subs.size === 1)
    m.subs.clear()
    const res = await r.client.reload('InkwellTest_Menu')
    expect(res).toEqual({ ok: true, reloaded: ['InkwellTest_Menu'], skipped: [{ name: 'Other', reason: 'unchanged' }], ms: 137 })
    expect(m.received.find((x) => x['type'] === 'reload')).toMatchObject({ id: 1, menu: 'InkwellTest_Menu' })
    await m.waitFor(() => m.subs.has('InkwellTest_Menu'))
  })
  it('without a menu name it reloads all; ids count up; ok:false carries the error', async () => {
    const m = await mock({ reload: () => ({ ok: false, reloaded: [], error: 'its file is invalid' }) })
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    const a = await r.client.reload()
    const b = await r.client.reload()
    expect(a).toMatchObject({ ok: false, error: 'its file is invalid' })
    expect(m.received.filter((x) => x['type'] === 'reload').map((x) => [x['id'], 'menu' in x])).toEqual([[1, false], [2, false]])
    expect(b.ok).toBe(false)
  })
  it('an unknown menu ends the request with the runtime error text', async () => {
    const m = await mock()
    const r = await rig(m)
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    const res = await r.client.reload('NoSuchMenu')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })
  it('not connected, no answer and a lost connection all resolve (never reject)', async () => {
    const m = await mock({ silentReload: true })
    const r = await rig(m, { reloadTimeoutMs: 80 })
    expect(await r.client.reload()).toMatchObject({ ok: false, error: 'The game is not connected.' })
    r.client.start()
    await r.until(() => r.phase() === 'connected')
    expect(await r.client.reload()).toMatchObject({ ok: false, error: expect.stringMatching(/did not answer/) })
    const lost = r.client.reload()
    m.drop()
    expect(await lost).toMatchObject({ ok: false, error: expect.stringMatching(/lost/) })
  })
})
