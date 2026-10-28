// A function graph and its caller compile with the real FFDec (needs Java, FFDec 26.3 and the wrapper jar like the other integration tests; skipped with a message otherwise).
// The behaviour (two overlapping calls on the same named Delay both finish) was checked once in Ruffle by hand: docs/functions.md, Verified.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Graph } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { compileSwf } from '../swf/compile'
import { frame, swf } from '../swf/ir.testutil'
import { graph, loadCore, node, wire } from './codegen.testutil'

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
if (!can) console.warn(`[functions FFDec test] SKIPPED: Java=${hasJava} FFDec=${existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar'))} wrapper jar=${existsSync(jarPath)}`)

const sig = {
  inputs: [{ id: 'i1', name: 'title', type: 'String' }],
  outputs: [{ id: 'o1', name: 'count', type: 'Number' }],
  exits: [{ id: 'x1', name: 'Done' }, { id: 'x2', name: 'Failed' }]
}

describe.skipIf(!can)('functions compile with FFDec', () => {
  it('the function class and its caller are both in the SWF, in the game flavour and the preview flavour', async () => {
    const packs = await loadCore()
    const fn = {
      ...graph('greet', [node('fe', 'core/FunctionEntry@1'), node('d', 'core/Delay@1', { name: 'wait' }), node('ok', 'core/FunctionExit@1', { exit: 'x1' }), node('num', 'core/ToNumber@1')],
        [wire('fe', 'then', 'd', 'in'), wire('d', 'then', 'ok', 'in'), wire('fe', 'title', 'num', 'value'), wire('num', 'value', 'ok', 'count')]),
      name: 'Greet', scope: 'function', signature: sig
    } as Graph
    const call = (id: string, title: string) => node(id, 'core/CallFunction@1', { function: 'greet', inputs: sig.inputs, outputs: sig.outputs, exits: sig.exits, title })
    const main = graph('main', [node('ol', 'core/OnLoad@1'), node('sq', 'core/Sequence@1'), call('c1', '1'), call('c2', '2'), node('l1', 'core/Log@1', { level: 'info' }), node('l2', 'core/Log@1', { level: 'info' })],
      [wire('ol', 'then', 'sq', 'in'), wire('sq', 'then0', 'c1', 'in'), wire('sq', 'then1', 'c2', 'in'), wire('c1', 'Done', 'l1', 'in'), wire('c2', 'Done', 'l2', 'in')])
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-fn-'))
    try {
      for (const preview of [false, true]) {
        const r = await compileSwf(swf([frame('f', [])], { id: 'fn' }), { modId: 'Fn', buildDir: join(dir, String(preview)), ffdec, graphs: { graphs: [main, fn], packs }, ...(preview ? { preview: true } : {}) })
        expect(r.lint.filter((l) => l.severity === 'error'), `preview=${preview}`).toEqual([])
        const xml = join(dir, `${preview}.xml`)
        execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', r.swfPath, xml], { stdio: 'ignore' })
        const text = readFileSync(xml, 'utf8')
        expect(text).toContain('__Packages.mods.Fn.FnGraph_main')
        expect(text).toContain('__Packages.mods.Fn.FnGraph_greet')
      }
    } finally {
      ffdec.stop()
    }
  }, 120_000)
})
