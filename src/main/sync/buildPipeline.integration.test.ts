// Runs only when Java, the user's FFDec and the built wrapper jar exist (like the other FFDec integration tests).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { PROTOCOL_VERSION, SPEC_VERSION, Swf } from '@inkwell-ui/spec'
import { loadProject } from '../project'
import { createBuildPipeline, envConfig } from './buildPipeline'
import { createTrust, hashSecret } from './figmaTrust'
import { startSyncServer } from './syncServer'

const SECRET = 'cd'.repeat(32)

const cfg = envConfig()
const jarPath = resolve(__dirname, '../../../tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const hasJava = (() => {
  try {
    execFileSync(cfg.javaPath, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const can = hasJava && existsSync(join(cfg.ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath)

const stops: (() => unknown)[] = []
afterEach(async () => {
  for (const s of stops.splice(0)) await s()
})

describe('build pipeline', () => {
  it('missing FFDec is a clear error', async () => {
    const p = createBuildPipeline({ ...cfg, ffdecDir: join(tmpdir(), 'no-ffdec-here'), buildDir: tmpdir(), jarPath })
    await expect(p.onChange('x', {} as Swf, 'x')).rejects.toThrow(/FFDec not found/)
  })

  it.skipIf(!can)('a patch for the sample IR writes a SWF', async () => {
    const sample = resolve(__dirname, '../../../samples/hud-minimal')
    const ir = Swf.parse((await loadProject(sample)).swfs['hud']!.ir)
    const buildDir = mkdtempSync(join(tmpdir(), 'inkwell-sync-'))
    const pipeline = createBuildPipeline({ ...cfg, jarPath, buildDir })
    stops.push(() => pipeline.stop())
    const server = await startSyncServer({ editorVersion: 't', ports: [0], debounceMs: 20, initial: { hud: ir }, onChange: pipeline.onChange, trust: createTrust({ store: { hashes: () => [hashSecret(SECRET)], add: async () => {} }, ask: async () => false }) })
    stops.push(() => server.close())
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`)
    const msgs: any[] = []
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())))
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ type: 'hello', pluginVersion: 't', protocolVersion: PROTOCOL_VERSION, specVersion: SPEC_VERSION, pluginSecret: SECRET, fileName: 't.fig' }))
    while (!msgs.some((m) => m.type === 'helloAck')) await new Promise((r) => setTimeout(r, 10)) // the plugin waits for the ack before sending patches
    const node = Object.values(ir.nodes).find((n) => n.type === 'shape')!
    ws.send(JSON.stringify({ type: 'patch', seq: 1, swfId: ir.id, patch: { ops: [{ op: 'upsert', node: { ...node, opacity: 0.9 } }] } }))
    const deadline = Date.now() + 30_000
    while (!msgs.some((m) => m.type === 'status' && m.state !== 'compiling') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    ws.close()
    expect(msgs.find((m) => m.type === 'status' && m.state !== 'compiling')).toMatchObject({ state: 'synced' })
    const out = join(buildDir, 'hud.swf')
    expect(existsSync(out) && statSync(out).size).toBeGreaterThan(100)
  }, 60_000)
})
