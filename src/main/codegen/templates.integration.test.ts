// Compiles the AS2 of every core pack template with the real FFDec (needs Java, FFDec 26.3 and the wrapper jar like the other integration tests;
// skipped with a message otherwise, so check the run output for "skipped"). A script FFDec cannot compile fails the build, and the compiled class must exist in the SWF.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { frame, swf, textNode } from '../swf/ir.testutil'
import { compileSwf } from '../swf/compile'
import { kindGraph, loadCore } from './codegen.testutil'

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
if (!can) console.warn(`[codegen FFDec test] SKIPPED: Java=${hasJava} FFDec=${existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar'))} wrapper jar=${existsSync(jarPath)}`)

describe.skipIf(!can)('every core template compiles with FFDec', () => {
  it('one class per node kind, each in its own SWF build', async () => {
    const packs = await loadCore()
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-tpl-'))
    const ir = swf([frame('f', ['L']), textNode('L')], { id: 'tpl' })
    const failures: string[] = []
    let compiled = 0
    try {
      for (const d of packs.defs.values()) {
        const g = kindGraph('core', d)
        if (!g) continue
        try {
          const r = await compileSwf(ir, { modId: 'Tpl', buildDir: join(dir, d.kind), ffdec, graphs: { graphs: [g], packs } })
          if (r.lint.some((l) => l.severity === 'error')) throw new Error(r.lint.map((l) => l.message).join('; '))
          const xml = join(dir, `${d.kind}.xml`)
          execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', r.swfPath, xml], { stdio: 'ignore' })
          expect(readFileSync(xml, 'utf8'), d.kind).toContain(`__Packages.mods.Tpl.TplGraph_k_${d.kind}`)
          compiled++
        } catch (e) {
          failures.push(`${d.kind}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } finally {
      ffdec.stop()
    }
    expect(failures).toEqual([])
    expect(compiled).toBe(115) // the 118 nodes of core pack 0.5.0 minus the 3 editor-only ones
  }, 300_000)
})
