// samples/inventory-replacement (the Phase 5 proof): its graph validates against the real core pack, and the SWF compiled by the real FFDec passes the
// contract check. The FFDec part is skipped without Java, FFDec or the wrapper jar. What it does in game is TEST-IN-GAME-0.5.md, Phase 5 checks.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { validateGraph } from '../../shared/graphValidate'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { contractFor, contractLint, contractsDir, loadContracts } from '../lint/contract'
import { loadProject } from '../project'
import { compileSwf } from '../swf/compile'
import { loadCore } from './codegen.testutil'

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
if (!can) console.warn(`[inventory sample test] SKIPPED the compile: Java=${hasJava} FFDec=${existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar'))} wrapper jar=${existsSync(jarPath)}`)

const sample = async () => {
  const project = await loadProject(resolve(__dirname, '../../../samples/inventory-replacement'))
  const s = project.swfs['inventory']!
  return { project, s, ir: Swf.parse(s.ir), graphs: Object.values(s.graphs ?? {}) }
}

describe('samples/inventory-replacement', () => {
  it('the graph has no validation issue', async () => {
    const { ir, graphs } = await sample()
    const { defs } = await loadCore()
    expect(graphs).toHaveLength(1)
    expect(validateGraph(graphs[0]!, { defs, layers: new Set(Object.keys(ir.nodes)), target: 'menuReplacement', contract: 'InventoryMenu' })).toEqual([])
  })

  it.skipIf(!can)('compiles with the real FFDec and passes the contract check', async () => {
    const { project, ir, graphs } = await sample()
    const layers = await loadContracts(contractsDir(resolve(__dirname, '../../..')))
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-invsample-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const r = await compileSwf(ir, { modId: project.meta.modId, buildDir: dir, ffdec, contract: contractFor(ir, layers)!, graphs: { graphs, packs: await loadCore() } })
      expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
      expect(contractLint(ir, r.layerPaths, layers, r.contractProvided)).toEqual([])
      const out = join(dir, 'swf.xml')
      execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', r.swfPath, out], { stdio: 'ignore' })
      const xml = readFileSync(out, 'utf8')
      for (const s of ['inkwellContract', 'GetInventoryItemList', 'keyName', 'UpdateItem3D', 'RequestItemCardInfo', 'SaveIndices']) expect(xml, s).toContain(Buffer.from(s).toString('hex'))
    } finally {
      ffdec.stop()
    }
  }, 120_000)
})
