// samples/stopwatch compiled by the real FFDec as a custom menu (the vector card instead of the PNG), skipped without Java, FFDec or the wrapper jar. The other examples are compiled
// by their own tests (inventory: codegen/inventorySample.integration.test.ts, gamepad: lint/focus.integration.test.ts, HUD popup: deploy tests).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { corePack } from '../codegen/codegen.testutil'
import { loadCodegenPacks } from '../codegen/packs'
import { compileSwf } from '../swf/compile'
import { loadProject } from './index'

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
const can = hasJava && existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath)
if (!can) console.warn(`[examples test] SKIPPED: Java=${hasJava} FFDec=${existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar'))} wrapper jar=${existsSync(jarPath)}`)

describe.skipIf(!can)('samples/stopwatch (real FFDec)', () => {
  it('compiles with its graph and a vector card, without an error', async () => {
    const project = await loadProject(resolve(__dirname, '../../../samples/stopwatch'))
    const s = project.swfs['menu_Stopwatch']!
    const nodes = (s.overlay as { nodes: Record<string, Record<string, unknown>> }).nodes
    const ir = Swf.parse(s.ir)
    expect(Object.values(ir.nodes).some((n) => n.type === 'image')).toBe(false)
    const { packs } = await loadCodegenPacks([corePack])
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-stopwatch-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const r = await compileSwf(ir, {
        modId: project.meta.modId, buildDir: dir, ffdec,
        instanceNames: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (typeof o['instanceName'] === 'string' ? [[id, o['instanceName']]] : []))),
        roles: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (typeof o['role'] === 'string' ? [[id, o['role']]] : []))),
        graphs: { graphs: Object.values(s.graphs ?? {}), packs }
      })
      expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
      expect(r.lint.filter((l) => /approximated/.test(l.code))).toEqual([]) // a plain card: no gradient or inside stroke to approximate
      expect(existsSync(r.swfPath)).toBe(true)
    } finally {
      ffdec.stop()
    }
  }, 120_000)
})
