import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { hashNode, Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { frame, rectShape, swf } from '../swf/ir.testutil'
import { loadProject } from './index'
import { FigmaSnapshot, readSnapshot, snapshotContent, staleSwfs, treeHash, writeSnapshot } from './snapshot'

const IMG = 'a'.repeat(40)
const hud = (): Swf => swf([{ ...frame('f', ['s', 'i']), name: 'HUD Frame' }, rectShape('s'), { ...frame('i', []), type: 'image', asset: IMG, scaleMode: 'fit' } as never], { id: 'f' })
const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'inkwell-snap-'))
const file = (dir: string): string => join(dir, 'figma', 'snapshot.json')

describe('figma/snapshot.json', () => {
  it('records frame ids and names, a hash tree root per SWF, assets and missing assets, the plugin; never a token', () => {
    const c = snapshotContent({ hud: hud() }, () => false, { pluginVersion: '0.3.0', fileKey: 'abc' })
    expect(c).toMatchObject({ schema: 1, source: { pluginVersion: '0.3.0', fileKey: 'abc' }, missingAssets: [IMG], swfs: { hud: { frameId: 'f', frameName: 'HUD Frame', nodes: 3, assets: [IMG] } } })
    expect(c.swfs['hud']!.rootHash).toBe(treeHash(hud()))
    expect(Object.keys(c).sort()).toEqual(['missingAssets', 'protocolVersion', 'schema', 'source', 'specVersion', 'swfs'])
    expect(snapshotContent({ hud: hud() }, () => true)).not.toHaveProperty('missingAssets')
  })

  it('the root hash is built from the same per-node hashNode the plugin hashTree sends, independent of key order', () => {
    const ir = hud()
    const reordered = { ...ir, nodes: Object.fromEntries(Object.entries(ir.nodes).reverse()) }
    expect(treeHash(reordered)).toBe(treeHash(ir))
    expect(treeHash(ir)).toBe(hashNode(Object.fromEntries(Object.entries(ir.nodes).map(([id, n]) => [id, hashNode(n)]))))
    const moved = { ...ir, nodes: { ...ir.nodes, s: { ...ir.nodes['s']!, x: 5 } } } as Swf
    expect(treeHash(moved)).not.toBe(treeHash(ir))
  })

  it('round-trips with stable bytes; an unchanged write does not touch the file or its time (no git churn)', async () => {
    const dir = await tmp()
    const t1 = new Date('2026-10-24T10:00:00Z')
    const a = await writeSnapshot(dir, snapshotContent({ hud: hud() }, () => true, { pluginVersion: '1' }), t1)
    expect(a.written).toBe(true)
    const bytes = await readFile(file(dir), 'utf8')
    expect(bytes).toMatch(/\n$/)
    expect(Object.keys(JSON.parse(bytes))).toEqual([...Object.keys(JSON.parse(bytes))].sort()) // sorted keys
    expect((await readSnapshot(dir)).snapshot).toEqual(a.snapshot)
    expect(FigmaSnapshot.parse(JSON.parse(bytes)).updatedAt).toBe(t1.toISOString())
    // same content, later time, no plugin this session (source kept): nothing written
    const b = await writeSnapshot(dir, snapshotContent({ hud: hud() }, () => true), new Date('2026-10-25T00:00:00Z'))
    expect(b.written).toBe(false)
    expect(await readFile(file(dir), 'utf8')).toBe(bytes)
    // a real change: rewritten with the new time
    const c = await writeSnapshot(dir, snapshotContent({ hud: hud() }, () => false), new Date('2026-10-26T00:00:00Z'))
    expect(c).toMatchObject({ written: true, snapshot: { updatedAt: '2026-10-26T00:00:00.000Z', missingAssets: [IMG], source: { pluginVersion: '1' } } })
  })

  it('a missing snapshot is no error; a corrupt or invalid one is reported and then replaced by the next write', async () => {
    const dir = await tmp()
    expect(await readSnapshot(dir)).toEqual({})
    await mkdir(join(dir, 'figma'))
    await writeFile(file(dir), '{ not json')
    expect((await readSnapshot(dir)).error).toMatch(/not valid JSON/)
    await writeFile(file(dir), JSON.stringify({ schema: 99 }))
    expect((await readSnapshot(dir)).error).toMatch(/not a valid snapshot/)
    expect((await writeSnapshot(dir, snapshotContent({ hud: hud() }, () => true))).written).toBe(true)
    expect((await readSnapshot(dir)).snapshot?.swfs['hud']).toBeDefined()
  })

  it('unknown keys of a newer editor survive a read', async () => {
    const dir = await tmp()
    await writeSnapshot(dir, snapshotContent({ hud: hud() }, () => true))
    const j = JSON.parse(await readFile(file(dir), 'utf8'))
    await writeFile(file(dir), JSON.stringify({ ...j, future: { x: 1 } }))
    expect((await readSnapshot(dir)).snapshot).toMatchObject({ future: { x: 1 } })
  })

  it('stale: an ir.json edited outside a sync, or a SWF only one side has', async () => {
    const s = FigmaSnapshot.parse({ ...snapshotContent({ hud: hud() }, () => true), updatedAt: 'x' })
    expect(staleSwfs(s, { hud: hud() })).toEqual([])
    const edited = { ...hud(), nodes: { ...hud().nodes, s: { ...hud().nodes['s']!, x: 9 } } } as Swf
    expect(staleSwfs(s, { hud: edited })).toEqual(['hud'])
    expect(staleSwfs(s, {})).toEqual(['hud'])
    expect(staleSwfs(s, { hud: hud(), menu: hud() })).toEqual(['menu'])
  })

  it('the samples carry a snapshot that matches their ir.json (the example project opens "Using Snapshot", not stale)', async () => {
    for (const name of ['hud-minimal', 'hud-widget', 'ingame-test']) {
      const dir = resolve(__dirname, '../../../samples', name)
      const snap = (await readSnapshot(dir)).snapshot
      const irs = Object.fromEntries(Object.entries((await loadProject(dir)).swfs).map(([n, x]) => [n, Swf.parse(x.ir)]))
      expect(snap && staleSwfs(snap, irs), name).toEqual([])
    }
  })
})
