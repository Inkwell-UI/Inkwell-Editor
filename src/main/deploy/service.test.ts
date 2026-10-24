// The export gate through the deploy service: prepare shows it, commit refuses a blocked deploy even when the renderer asks.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import type { DeployLintItem, DeployState } from '../../shared/deploy'
import { frame } from '../swf/ir.testutil'
import type { DeploySwf } from './run'
import { createDeployService } from './service'

function setup(lint: DeployLintItem[], strictMode = false) {
  const tmp = mkdtempSync(join(tmpdir(), 'inkwell-svc-'))
  const dir = join(tmp, 'project')
  mkdirSync(join(dir, 'build'), { recursive: true })
  writeFileSync(join(dir, 'build', 'wheel.swf'), 'FWS-mine')
  const swf: DeploySwf = { name: 'wheel', orphaned: false, kind: 'customMenu', ir: { root: 'r', nodes: { r: frame('r', []) } } as unknown as Swf, build: { state: 'done', lint } }
  const reports: DeployState[] = []
  const mods = join(tmp, 'mods')
  const svc = createDeployService({
    userData: join(tmp, 'userData'), appPath: tmp,
    project: () => ({ dir, name: 'Test', modId: 'T', swfs: [swf], strictMode }),
    settings: () => ({ stored: {}, resolved: { ffdecDir: '', javaPath: '', source: {}, mo2ModsDir: mods } }),
    saveStored: async () => undefined,
    ffdec: () => ({ build: () => Promise.reject(new Error('unused')) }),
    report: (s) => void reports.push(s)
  })
  return { svc, root: join(mods, 'Test'), reports }
}
const warn: DeployLintItem = { severity: 'warning', code: 'font-fallback', message: 'nearest alias', nodeId: '1:2', layerName: 'Title' }
const err: DeployLintItem = { severity: 'error', code: 'font-unmapped', message: 'no alias', nodeId: '1:3', layerName: 'Sub' }

describe('deploy service export gate', () => {
  it('a warning passes: listed in the gate, the commit writes', async () => {
    const { svc, root } = setup([warn])
    const p = await svc.prepare('mo2Mod', 'all')
    if (!p.ok) throw new Error(p.error)
    expect(p.gate).toMatchObject({ ok: true, blocking: [], warnings: [{ code: 'font-fallback', swf: 'wheel', nodeId: '1:2' }] })
    expect((await svc.commit(p.token)).ok).toBe(true)
    expect(existsSync(join(root, 'Interface', 'wheel.swf'))).toBe(true)
  })

  it('an error blocks: the dialog is forced, the commit is refused and nothing is written', async () => {
    const { svc, root, reports } = setup([err])
    const p = await svc.prepare('mo2Mod', 'all')
    if (!p.ok) throw new Error(p.error)
    expect(p).toMatchObject({ needsConfirm: true, gate: { ok: false, blocking: [{ code: 'font-unmapped', swf: 'wheel', nodeId: '1:3' }] } })
    expect(reports.at(-1)).toMatchObject({ state: 'error', message: expect.stringContaining('Deploy blocked: 1 lint error') })
    expect(await svc.commit(p.token)).toMatchObject({ ok: false, error: expect.stringContaining('Deploy blocked') })
    expect(existsSync(root)).toBe(false)
  })

  it('Strict Mode blocks a warning', async () => {
    const { svc, root } = setup([warn], true)
    const p = await svc.prepare('mo2Mod', 'all')
    if (!p.ok) throw new Error(p.error)
    expect(p.gate).toMatchObject({ ok: false, strict: true, blocking: [{ code: 'font-fallback', severity: 'error' }] })
    expect((await svc.commit(p.token)).ok).toBe(false)
    expect(existsSync(root)).toBe(false)
  })
})
