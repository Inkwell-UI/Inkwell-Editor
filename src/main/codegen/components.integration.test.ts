// Runs only when Java, the user's FFDec and the built wrapper jar exist (yarn build:wrapper), like the other integration tests.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newComponentGraph } from '../../shared/graphs'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { compileSwf } from '../swf/compile'
import { frame, rectShape, swf } from '../swf/ir.testutil'
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

describe.skipIf(!can)('Create Component in an auto-layout parent (real FFDec)', () => {
  it('the generated stack methods (stackSize with the design size, restack) compile', async () => {
    const packs = await loadCore()
    const comp = { ...frame('5:1', ['5:2']), type: 'component', variants: [{ name: 'Default', node: '5:1' }] }
    const parent = frame('p', ['d'], { autoLayout: { mode: 'vertical', spacing: 10, padding: [8, 8, 8, 8], primaryAlign: 'start', counterAlign: 'start', wrap: false } })
    const ir = swf([frame('f', ['p']), parent, { ...rectShape('d'), parent: 'p' }])
    const menu = { ...graph('main', [node('ol', 'core/OnLoad@1'), node('cc', 'core/CreateComponent@1', { component: '5:1', parent: 'p' })], [wire('ol', 'then', 'cc', 'in')]), variables: [{ id: 'sel', name: 'selected', type: 'String' as const, scope: 'menu' as const, default: '' }] }
    // the component sets the menu variable `selected` (reached through the owner chain)
    const compGraph = {
      ...newComponentGraph('5:1', 'ListItem'),
      props: [{ id: 'p1', name: 'label', type: 'String' as const, default: '' }],
      nodes: [node('ol', 'core/OnLoad@1'), node('sv', 'core/SetVariable@1', { variable: 'sel' }), node('gp', 'core/GetProp@1', { prop: 'p1', propType: 'String', propName: 'label' })],
      edges: [wire('ol', 'then', 'sv', 'in'), wire('gp', 'value', 'sv', 'value')]
    }
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const r = await compileSwf(ir, {
        modId: 'ItestMod', buildDir: mkdtempSync(join(tmpdir(), 'inkwell-comp-')), ffdec,
        graphs: { graphs: [menu, compGraph as never], packs },
        components: [{ id: '5:1', name: 'ListItem', nodes: { '5:1': comp as never, '5:2': { ...rectShape('5:2'), parent: '5:1' } } }]
      })
      expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
    } finally {
      ffdec.stop()
    }
  }, 120_000)
})
