import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { hashNode, PROTOCOL_VERSION, SPEC_VERSION, type Swf } from '@inkwell-ui/spec'
import { createAssetStore } from '../images/assets'
import { syntheticPng } from '../images/synthetic'
import { frame, rectShape, swf } from '../swf/ir.testutil'
import { treeHash } from '../project/snapshot'
import { createTrust, hashSecret } from './figmaTrust'
import { sanitizeName, startSyncServer, unreachableNodes, type SyncServerOptions } from './syncServer'

type Server = Awaited<ReturnType<typeof startSyncServer>>
const open: Server[] = []
const clients: WebSocket[] = []
afterEach(async () => {
  clients.splice(0).forEach((c) => c.terminate())
  await Promise.all(open.splice(0).map((s) => s.close()))
})

const SECRET = 'ab'.repeat(32)
/** A trust that already knows SECRET (the common case: an approved plugin). */
const knownTrust = () => createTrust({ store: { hashes: () => [hashSecret(SECRET)], add: async () => {} }, ask: async () => false })
const start = async (o: Partial<Omit<SyncServerOptions, 'trust'>> & { trust?: SyncServerOptions['trust'] } = {}): Promise<Server> => {
  const s = await startSyncServer({ editorVersion: '0.0.1', ports: [0], debounceMs: 20, trust: knownTrust(), ...o })
  open.push(s)
  return s
}
const connect = (s: Server, o: { origin?: string } = {}) =>
  new Promise<{ ws: WebSocket; next: () => Promise<any> }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/`, { headers: o.origin ? { Origin: o.origin } : {} })
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
const hello = (over: object = {}) => ({ type: 'hello', pluginVersion: '0.0.1', protocolVersion: PROTOCOL_VERSION, specVersion: SPEC_VERSION, pluginSecret: SECRET, fileName: 'Hud.fig', ...over })
const ready = async (s: Server) => {
  const c = await connect(s)
  c.ws.send(JSON.stringify(hello()))
  expect((await c.next()).ok).toBe(true)
  return c
}
const sample = (): Swf => swf([frame('f', ['s']), rectShape('s')], { id: 'hud' })
const patchUpsert = (node: unknown, swfId = 'hud', swf?: unknown) => ({ type: 'patch', seq: 1, swfId, ...(swf ? { swf } : {}), patch: { ops: [{ op: 'upsert', node }] } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('syncServer', () => {
  it('selectNode (protocol 5) goes to approved plugins only; with none connected it reaches nobody', async () => {
    const s = await start()
    expect(s.selectNode('1:2', false)).toBe(0)
    const waiting = await connect(s) // no hello yet: not approved, not connected
    const c = await ready(s)
    expect(s.selectNode('1:2', true)).toBe(1)
    expect(await c.next()).toEqual({ type: 'selectNode', nodeId: '1:2', focus: true })
    expect(s.selectNode('1:3', false)).toBe(1)
    expect(await c.next()).toEqual({ type: 'selectNode', nodeId: '1:3', focus: false })
    expect(s.selectNode('', false)).toBe(0) // invalid id: nothing sent
    waiting.ws.close()
  })

  it('rejects a web origin (403); accepts the null origin and no origin; no token is needed', async () => {
    const s = await start()
    await expect(connect(s, { origin: 'https://evil.example' })).rejects.toThrow('403')
    await connect(s, { origin: 'null' })
    await connect(s)
    expect('token' in s).toBe(false)
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
    const node = { ...s.ir('hud')!.nodes['s'], opacity: 0.5, extra: { keep: 1 } }
    c.ws.send(JSON.stringify(patchUpsert(node)))
    c.ws.send(JSON.stringify(patchUpsert({ ...node, opacity: 0.25 })))
    await sleep(150)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).toBe('hud')
    expect(s.ir('hud')!.nodes['s']).toMatchObject({ opacity: 0.25, extra: { keep: 1 } })
  })

  it('empty store: the first patch with swf metadata creates the swf with the frame as root and its stage size', async () => {
    const s = await start()
    const c = await ready(s)
    c.ws.send(JSON.stringify(patchUpsert(frame('1:1', []), '1:1', { id: '1:1', name: 'Hud Main', stage: { width: 640, height: 360 } })))
    await sleep(60)
    expect(s.ir('1:1')).toMatchObject({ root: '1:1', name: 'Hud_Main', stage: { width: 640, height: 360 } })
    expect(s.swfs()).toEqual([{ id: '1:1', name: 'Hud_Main', orphaned: false }])
  })

  it('two frames are two independent swfs, each built once with its own name', async () => {
    const onChange = vi.fn()
    const s = await start({ onChange })
    const c = await ready(s)
    c.ws.send(JSON.stringify(patchUpsert(frame('1:1', []), '1:1', { id: '1:1', name: 'Menu', stage: { width: 10, height: 20 } })))
    c.ws.send(JSON.stringify(patchUpsert(frame('2:1', []), '2:1', { id: '2:1', name: 'menu', stage: { width: 30, height: 40 } })))
    await sleep(150)
    expect(onChange.mock.calls.map((x) => [x[0], x[2]]).sort()).toEqual([['1:1', 'Menu'], ['2:1', 'menu_2']]) // clash is made unique
    expect(s.ir('2:1')!.stage).toEqual({ width: 30, height: 40 })
    expect(Object.keys(s.ir('1:1')!.nodes)).toEqual(['1:1'])
  })

  it('swfs message marks missing frames orphaned (data kept), reports loose layers, and the plugin gets warnings', async () => {
    const onChange = vi.fn()
    const s = await start({ initial: { hud: sample() }, onChange })
    const c = await ready(s)
    const seen = new Promise<any[]>((r) => s.events.once('swfs', (i, l) => r([i, l])))
    c.ws.send(JSON.stringify({ type: 'swfs', frames: [{ id: '9:9', name: 'Other' }], loose: [{ id: '3:3', name: 'Stray text' }] }))
    const [infos, loose] = await seen
    expect(infos).toEqual([{ id: 'hud', name: 'hud', orphaned: true }])
    expect(loose).toEqual([{ id: '3:3', name: 'Stray text' }])
    const st = await c.next()
    expect(st).toMatchObject({ type: 'status', state: 'synced' })
    expect(st.issues).toMatchObject([
      { code: 'unreachable-node', severity: 'warning', nodeId: '3:3', message: expect.stringContaining('not inside an exported frame') },
      { code: 'orphaned-swf', nodeId: 'hud' }
    ])
    expect(s.ir('hud')).toBeDefined() // not deleted
  })

  it('removing the frame root keeps the last IR, marks it orphaned and builds nothing', async () => {
    const onChange = vi.fn()
    const s = await start({ initial: { hud: sample() }, onChange })
    const c = await ready(s)
    c.ws.send(JSON.stringify({ type: 'patch', seq: 3, swfId: 'hud', patch: { ops: [{ op: 'remove', id: 'f' }] } }))
    await sleep(80)
    expect(s.swfs()).toEqual([{ id: 'hud', name: 'hud', orphaned: true }])
    expect(Object.keys(s.ir('hud')!.nodes).sort()).toEqual(['f', 's'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('forget drops an orphaned swf only; a swf with a frame is refused', async () => {
    const s = await start({ initial: { hud: sample() }, onChange: vi.fn() })
    expect(s.forget('hud')).toBe(false)
    expect(s.swfs()).toHaveLength(1)
    const c = await ready(s)
    c.ws.send(JSON.stringify({ type: 'swfs', frames: [], loose: [] }))
    await sleep(80)
    expect(s.forget('hud')).toBe(true)
    expect(s.swfs()).toEqual([])
    expect(s.ir('hud')).toBeUndefined()
  })

  it('swf metadata themes land in the IR, an empty list clears them and a patch without them keeps them', async () => {
    const s = await start({ initial: { hud: sample() }, onChange: vi.fn() })
    const c = await ready(s)
    const meta = (themes?: unknown[]) => ({ id: 'hud', name: 'hud', stage: { width: 1280, height: 720 }, ...(themes ? { themes } : {}) })
    const t = { name: 'Colors', modes: ['A', 'B'], variables: {} }
    c.ws.send(JSON.stringify({ type: 'patch', seq: 3, swfId: 'hud', swf: meta([t]), patch: { ops: [] } }))
    await sleep(80)
    expect(s.ir('hud')!.themes).toEqual([t])
    c.ws.send(JSON.stringify({ type: 'patch', seq: 4, swfId: 'hud', swf: meta(), patch: { ops: [] } }))
    await sleep(80)
    expect(s.ir('hud')!.themes).toEqual([t])
    c.ws.send(JSON.stringify({ type: 'patch', seq: 5, swfId: 'hud', swf: meta([]), patch: { ops: [] } }))
    await sleep(80)
    expect(s.ir('hud')!.themes).toEqual([])
  })

  it('setTarget changes the swf target and a later patch keeps it', async () => {
    const onChange = vi.fn()
    const s = await start({ initial: { hud: sample() }, onChange })
    expect(s.setTarget('nope', 'customMenu')).toBe(false)
    expect(s.setTarget('hud', 'customMenu')).toBe(true)
    expect(s.ir('hud')!.target.kind).toBe('customMenu')
    const c = await ready(s)
    c.ws.send(JSON.stringify({ type: 'patch', seq: 3, swfId: 'hud', patch: { ops: [] } }))
    await sleep(80)
    expect(s.ir('hud')!.target.kind).toBe('customMenu')
    expect(onChange).toHaveBeenCalled()
    // a menu replacement's contract and layers (W5); an empty value removes them, an omitted one is kept
    expect(s.setTarget('hud', 'menuReplacement', { contract: 'InventoryMenu', layers: ['engine', 'skyui52'] })).toBe(true)
    expect(s.ir('hud')!.target).toEqual({ kind: 'menuReplacement', contract: 'InventoryMenu', layers: ['engine', 'skyui52'] })
    s.setTarget('hud', 'menuReplacement', { layers: [] })
    expect(s.ir('hud')!.target).toEqual({ kind: 'menuReplacement', contract: 'InventoryMenu' })
  })

  it('a node no root reaches gets an unreachable-node warning on that swf', async () => {
    const s = await start({ initial: { hud: sample() }, onChange: () => ({ issues: [] }) })
    const c = await ready(s)
    c.ws.send(JSON.stringify(patchUpsert({ ...frame('x', []), name: 'Floating' })))
    expect(await c.next()).toMatchObject({ state: 'compiling', swfId: 'hud' })
    const done = await c.next()
    expect(done).toMatchObject({ swfId: 'hud', state: 'synced', issues: [{ code: 'unreachable-node', severity: 'warning', nodeId: 'x' }] })
    expect(done.issues[0].message).toContain('not inside an exported frame')
  })

  it('unreachableNodes and sanitizeName', () => {
    expect(unreachableNodes(sample())).toEqual([])
    expect(unreachableNodes(swf([frame('f', []), rectShape('s')]))).toEqual(['s'])
    expect(sanitizeName('Menu / Main*', '1:2')).toBe('Menu_Main')
    expect(sanitizeName('???', '1:2')).toBe('1_2')
  })

  it('PatchError becomes an error message with the node id and the store is unchanged', async () => {
    const onChange = vi.fn()
    const s = await start({ initial: { hud: sample() }, onChange })
    const c = await ready(s)
    const before = s.ir('hud')
    c.ws.send(JSON.stringify({ type: 'patch', seq: 2, swfId: 'hud', patch: { ops: [{ op: 'move', id: 'nope', parent: 'f' }] } }))
    expect(await c.next()).toMatchObject({ type: 'error', code: 'unknown_node', nodeId: 'nope' })
    expect(s.ir('hud')).toBe(before)
    await sleep(60)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hashTree: mismatched and missing nodes are resent, matching ones are not', async () => {
    const s = await start({ initial: { hud: sample() } })
    const c = await ready(s)
    const n = s.ir('hud')!.nodes
    c.ws.send(JSON.stringify({ type: 'hashTree', swfId: 'hud', nodeHashes: { f: hashNode(n['f']), s: 'deadbeef', gone: '00000000' } }))
    const r = await c.next()
    expect(r).toMatchObject({ type: 'resend', swfId: 'hud' })
    expect([...r.ids].sort()).toEqual(['gone', 's'])
  })

  it('hashTree: a node the plugin lacks and no root reaches (deleted while it was disconnected) is dropped with its subtree; one the plugin still lists is kept', async () => {
    const ir = swf([frame('f', ['s']), rectShape('s'), rectShape('stale1'), frame('ghost', ['stale2']), { ...rectShape('stale2'), parent: 'ghost' }], { id: 'hud' })
    const onChange = vi.fn(() => ({ issues: [] }))
    const s = await start({ initial: { hud: ir }, onChange })
    const c = await ready(s)
    expect(unreachableNodes(ir).sort()).toEqual(['ghost', 'stale1', 'stale2'])
    c.ws.send(JSON.stringify({ type: 'hashTree', swfId: 'hud', nodeHashes: { f: hashNode(ir.nodes['f']), s: hashNode(ir.nodes['s']), stale1: 'x' } }))
    const r = await c.next()
    expect(r).toMatchObject({ type: 'resend', swfId: 'hud', ids: ['stale1'] })
    expect(Object.keys(s.ir('hud')!.nodes).sort()).toEqual(['f', 's', 'stale1'])
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled()) // the rebuild saves the IR without the dropped nodes
  })

  it('reconnect after an offline session: a plugin with the same tree as the saved IR (the snapshot root) gets an empty resend', async () => {
    const saved = sample()
    const s = await start({ initial: { hud: saved } })
    const hellos: unknown[] = []
    s.events.on('hello', (h) => hellos.push(h))
    const c = await connect(s)
    c.ws.send(JSON.stringify(hello({ fileKey: 'FILE' })))
    expect((await c.next()).ok).toBe(true)
    expect(hellos).toEqual([{ pluginVersion: '0.0.1', fileKey: 'FILE' }]) // provenance for figma/snapshot.json
    const live = Object.fromEntries(Object.entries(saved.nodes).map(([id, n]) => [id, hashNode(n)]))
    expect(treeHash({ nodes: s.ir('hud')!.nodes })).toBe(treeHash(saved))
    c.ws.send(JSON.stringify({ type: 'hashTree', swfId: 'hud', nodeHashes: live }))
    expect(await c.next()).toMatchObject({ type: 'resend', swfId: 'hud', ids: [] })
    c.ws.send(JSON.stringify({ type: 'hashTree', swfId: 'hud', nodeHashes: { ...live, s: 'changed0' } }))
    expect((await c.next()).ids).toEqual(['s']) // only the difference is patched
  })

  it('malformed JSON and unknown messages yield error and keep the socket', async () => {
    const s = await start()
    const c = await ready(s)
    c.ws.send('{nope')
    expect((await c.next()).code).toBe('bad_json')
    c.ws.send(JSON.stringify({ type: 'wat' }))
    expect((await c.next()).code).toBe('invalid_message')
    c.ws.send(JSON.stringify({ type: 'patch', seq: 1, swfId: 'hud', patch: { ops: [{ op: 'upsert', node: { id: 1 } }] } }))
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
    c.ws.send(JSON.stringify(patchUpsert({ ...s.ir('hud')!.nodes['s'], opacity: 0.1 })))
    expect(await c.next()).toEqual({ type: 'status', swfId: 'hud', state: 'compiling' })
    expect(await c.next()).toMatchObject({ type: 'status', state: 'synced', issues: [{ code: 'w' }] })
    fail = true
    c.ws.send(JSON.stringify(patchUpsert({ ...s.ir('hud')!.nodes['s'], opacity: 0.2 })))
    expect((await c.next()).state).toBe('compiling')
    expect(await c.next()).toMatchObject({ state: 'error', issues: [{ message: 'FFDec not found' }] })
  })

  it('strict mode promotes warnings to errors in the status (the build gate); rebuildAll queues every live swf', async () => {
    let strict = false
    const onChange = vi.fn(async () => ({ issues: [{ code: 'w', message: 'warn', nodeId: 's', severity: 'warning' }] }))
    const s = await start({ initial: { hud: sample() }, onChange, strict: () => strict })
    const c = await ready(s)
    expect(s.rebuildAll()).toBe(1)
    expect((await c.next()).state).toBe('compiling')
    expect(await c.next()).toMatchObject({ state: 'synced', issues: [{ severity: 'warning' }] })
    strict = true
    s.rebuild('hud')
    expect((await c.next()).state).toBe('compiling')
    expect(await c.next()).toMatchObject({ state: 'error', issues: [{ severity: 'error', code: 'w' }] })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('tells the UI why a connection failed: version mismatch (handshakeFailed) and bad origin (rejected)', async () => {
    const s = await start()
    const version = new Promise<string>((r) => s.events.once('handshakeFailed', r))
    const bad = await connect(s)
    bad.ws.send(JSON.stringify(hello({ protocolVersion: PROTOCOL_VERSION + 1 })))
    expect(await version).toMatch(/Protocol mismatch/)
    const rejected = new Promise<string>((r) => s.events.once('rejected', r))
    await expect(connect(s, { origin: 'https://evil.example' })).rejects.toThrow('403')
    expect(await rejected).toBe('origin')
  })
})

describe('syncServer images (protocol 3)', () => {
  const A = syntheticPng(8, 8)
  const B = syntheticPng(4, 4)
  const withImage = (hash: string) => ({ ...rectShape('img'), parent: 'f', type: 'image', asset: hash, scaleMode: 'fill' })
  const until = async (c: { next: () => Promise<any> }, type: string) => {
    for (;;) {
      const m = await c.next()
      if (m.type === type) return m
    }
  }

  it('asks once per hash for images it lacks, stores what arrives and rebuilds the swf that uses it', async () => {
    const assets = createAssetStore()
    const onChange = vi.fn()
    const s = await start({ initial: { hud: sample() }, onChange, assets })
    const c = await ready(s)
    const all: any[] = []
    c.ws.on('message', (d) => all.push(JSON.parse(d.toString())))
    c.ws.send(JSON.stringify(patchUpsert(withImage(A.hash))))
    expect(await until(c, 'needAssets')).toEqual({ type: 'needAssets', hashes: [A.hash] })
    c.ws.send(JSON.stringify(patchUpsert({ ...withImage(A.hash), name: 'renamed' }))) // same hash: not asked again
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    c.ws.send(JSON.stringify({ type: 'asset', hash: A.hash, data: A.png.toString('base64') }))
    await vi.waitFor(() => expect(assets.has(A.hash)).toBe(true))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2)) // the asset's arrival rebuilds
    expect(assets.get(A.hash)).toEqual(A.image)
    expect(all.filter((m) => m.type === 'needAssets')).toHaveLength(1)
    // a new connection's hash tree asks for a hash that is still missing, never for the stored one
    const nodes = s.ir('hud')!.nodes
    nodes['img2'] = { ...withImage(B.hash), id: 'img2' } as never
    nodes['f'] = { ...nodes['f']!, children: [...nodes['f']!.children, 'img2'] } // reachable: an unreachable node the plugin lacks is dropped (next test)
    const c2 = await ready(s)
    c2.ws.send(JSON.stringify({ type: 'hashTree', swfId: 'hud', nodeHashes: {} }))
    expect(await until(c2, 'needAssets')).toEqual({ type: 'needAssets', hashes: [B.hash] })
  })

  it('refuses an asset that is not a readable PNG or has a bad hash, and stores nothing', async () => {
    const assets = createAssetStore()
    const s = await start({ initial: { hud: sample() }, assets })
    const c = await ready(s)
    c.ws.send(JSON.stringify({ type: 'asset', hash: A.hash, data: Buffer.from('not a png').toString('base64') }))
    expect(await until(c, 'error')).toMatchObject({ code: 'bad_asset', message: expect.stringContaining('not a PNG') })
    c.ws.send(JSON.stringify({ type: 'asset', hash: '../../x', data: A.png.toString('base64') }))
    expect(await until(c, 'error')).toMatchObject({ code: 'invalid_message' })
    expect(assets.has(A.hash)).toBe(false)
  })

  it('without an asset store, nothing is requested and an asset is refused', async () => {
    const s = await start({ initial: { hud: sample() } })
    const c = await ready(s)
    c.ws.send(JSON.stringify(patchUpsert(withImage(A.hash))))
    c.ws.send(JSON.stringify({ type: 'asset', hash: A.hash, data: A.png.toString('base64') }))
    expect(await until(c, 'error')).toMatchObject({ code: 'assets_unsupported' })
  })
})
