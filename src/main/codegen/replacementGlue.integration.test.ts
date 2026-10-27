// A menu replacement with the engine glue and every Inventory contract node, compiled by the real FFDec (the AS2 must parse), as the game SWF and
// as the Ruffle preview SWF. Skipped without Java, FFDec or the wrapper jar (a warning says so). What the glue DOES is the owner's in-game test (Phase 5).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { contractFor, contractLint, contractsDir, loadContracts } from '../lint/contract'
import { compileSwf } from '../swf/compile'
import { frame, swf, textNode } from '../swf/ir.testutil'
import { inventoryGraph, loadCore } from './codegen.testutil'

const ffdecDir = process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
const javaPath = process.env['INKWELL_JAVA'] ?? 'java'
const jarPath = resolve(__dirname, '../../../tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const hasJava = (() => {
  try {
    execFileSync(javaPath, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const can = hasJava && existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath) && existsSync(join(ffdecDir, 'ffdec-cli.jar'))
if (!can) console.warn(`[replacement glue test] SKIPPED: Java=${hasJava} FFDec=${existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar'))} wrapper jar=${existsSync(jarPath)}`)

const hex = (s: string): string => Buffer.from(s).toString('hex')

describe.skipIf(!can)('Inventory replacement (real FFDec)', () => {
  const run = async (preview: boolean) => {
    const layers = await loadContracts(contractsDir(resolve(__dirname, '../../..')))
    const ir = swf([frame('r', ['m']), { ...frame('m', ['t']), name: 'Menu_mc', parent: 'r' }, { ...textNode('t'), parent: 'm' }] as Parameters<typeof swf>[0], {
      id: 'inv', target: { kind: 'menuReplacement', contract: 'InventoryMenu', layers: ['engine', 'skyui52', 'skyui6'] }
    })
    const contract = contractFor(ir, layers)!
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-replacement-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const r = await compileSwf(ir, { modId: 'InvTest', buildDir: dir, ffdec, contract, graphs: { graphs: [inventoryGraph()], packs: await loadCore() }, ...(preview ? { preview: true } : {}) })
      expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
      expect(contractLint(ir, r.layerPaths, layers, r.contractProvided)).toEqual([])
      const out = join(dir, 'swf.xml')
      execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', r.swfPath, out], { stdio: 'ignore' })
      return readFileSync(out, 'utf8')
    } finally {
      ffdec.stop()
    }
  }

  it('game SWF: the glue class, the graph class, the engine bridge and the SkyUI 5.2 statics; the contract check passes', async () => {
    const xml = await run(false)
    expect(xml).toContain('__Packages.mods.InvTest.InvContract')
    expect(xml).toContain('__Packages.mods.InvTest.InvGraph_inv')
    for (const s of ['inkwellContract', 'GetInventoryItemList', 'addCallback', 'respond', 'SKYUI_RELEASE_IDX', '5.2 SE', 'RequestItemCardInfo', 'UpdateItemCardInfo']) expect(xml, s).toContain(hex(s))
  }, 120_000)

  it('preview SWF: the same glue without the engine bridge', async () => {
    const xml = await run(true)
    expect(xml).toContain('__Packages.mods.InvTest.InvContract')
    expect(xml).toContain(hex('engine call '))
  }, 120_000)
})
