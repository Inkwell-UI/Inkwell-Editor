import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Graph } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { generateGraphClasses } from '../codegen/codegen'
import { graph, loadCore, node, wire } from '../codegen/codegen.testutil'
import { loadCodegenPacks } from '../codegen/packs'
import { newFunctionGraph, callFields } from '../../shared/functions'
import { validateGraph } from '../../shared/graphValidate'
import { corePack } from '../codegen/codegen.testutil'
import { exportLibrary, importLibrary, localLibraryDirs, removeLibrary } from './libraries'

const packs = await loadCore()
const tmp = () => mkdtempSync(join(tmpdir(), 'inkwell-libtest-'))
let n = 0
const ids = () => `p${++n}`

/** inner(): Entry -> Log -> Exit.  outer(): Entry -> Call inner -> Exit. */
function project() {
  const inner = newFunctionGraph('inner', 'Inner', ids)
  inner.nodes.splice(1, 0, node('log', 'core/Log@1', { level: 'info', message: 'hi' }))
  const feId = inner.nodes[0]!.id
  const fxId = inner.nodes[2]!.id
  inner.edges = [wire(feId, 'then', 'log', 'in'), wire('log', 'then', fxId, 'in')] as Graph['edges']
  const outer = newFunctionGraph('outer', 'Outer', ids)
  const call = node('c', 'core/CallFunction@1', callFields(inner))
  outer.nodes.splice(1, 0, call)
  const oFe = outer.nodes[0]!.id
  const oFx = outer.nodes[2]!.id
  outer.edges = [wire(oFe, 'then', 'c', 'in'), wire('c', 'Done', oFx, 'in')] as Graph['edges']
  return { inner, outer }
}
const base = (out: string, selected: string[], fns: Graph[]) => ({
  functions: fns, selected, pack: { id: 'my-lib', version: '1.0.0', description: 'Helpers', credits: 'Me' },
  defs: packs.defs, packVersions: new Map([['core', '0.5.5']]), toolVersion: '0.5.0', outDir: out
})

describe('exportLibrary', () => {
  it('writes the pack folder and a zip; calls between the functions become <pack>/<id>', async () => {
    const { inner, outer } = project()
    const out = tmp()
    const r = await exportLibrary(base(out, ['inner', 'outer'], [inner, outer]))
    if (!r.ok) throw new Error(r.error)
    expect(r.dependencies).toEqual({ core: '^0.5.5' })
    const manifest = JSON.parse(readFileSync(join(r.folder, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({ id: 'my-lib', version: '1.0.0', compatible: { tool: '^0.5.0' }, extra: { description: 'Helpers', credits: 'Me' } })
    const exported = JSON.parse(readFileSync(join(r.folder, 'functions/outer.json'), 'utf8')) as Graph
    expect(exported.nodes.find((x) => x.id === 'c')!.fields['function']).toBe('my-lib/inner')
    expect(existsSync(r.zip)).toBe(true)
    expect(r.zip.endsWith('my-lib-1.0.0.zip')).toBe(true)
  })

  it('refuses a selected function that calls one that is not selected, naming it', async () => {
    const { inner, outer } = project()
    const r = await exportLibrary(base(tmp(), ['outer'], [inner, outer]))
    expect(r).toEqual({ ok: false, error: expect.stringContaining('"Outer" calls "Inner", which is not ticked') })
  })

  it('refuses bad ids, versions, the core id, an empty selection and a function with errors', async () => {
    const { inner, outer } = project()
    const go = (over: Record<string, unknown>) => exportLibrary({ ...base(tmp(), ['inner'], [inner, outer]), ...over } as never)
    expect(((await go({ pack: { id: 'Bad Id', version: '1.0.0' } })) as { error: string }).error).toContain('lower-case')
    expect(((await go({ pack: { id: 'core', version: '1.0.0' } })) as { error: string }).error).toContain('core')
    expect(((await go({ pack: { id: 'x', version: '1.0' } })) as { error: string }).error).toContain('1.0.0')
    expect(((await go({ selected: [] })) as { error: string }).error).toContain('Tick')
    const broken = { ...inner, nodes: inner.nodes.filter((x) => !x.kind.includes('FunctionEntry')) } as Graph
    expect(((await go({ functions: [broken, outer] })) as { error: string }).error).toContain('has errors')
  })
})

describe('importLibrary and the loader', () => {
  it('imports an exported zip into libraries/, the functions load as <pack>/<id>, and a caller compiles them', async () => {
    const { inner, outer } = project()
    const out = tmp()
    const e = await exportLibrary(base(out, ['inner', 'outer'], [inner, outer]))
    if (!e.ok) throw new Error(e.error)
    const projectDir = tmp()
    const r = await importLibrary(projectDir, e.zip)
    expect(r).toEqual({ ok: true, id: 'my-lib', version: '1.0.0', functions: ['inner', 'outer'], nodes: 0 })
    const dirs = await localLibraryDirs(projectDir)
    expect(dirs).toHaveLength(1)
    const { packs: cg, problems } = await loadCodegenPacks([corePack, ...dirs])
    expect(problems).toEqual([])
    expect([...cg.functions!.keys()].sort()).toEqual(['my-lib/inner', 'my-lib/outer'])
    // a menu graph calls the library function; only the functions it reaches are compiled in, with the library calls resolved
    const lib = cg.functions!.get('my-lib/outer')!
    const main = graph('main', [node('ol', 'core/OnLoad@1'), node('c', 'core/CallFunction@1', callFields({ ...lib, id: 'my-lib/outer' } as Graph))], [wire('ol', 'then', 'c', 'in')])
    main.nodes[1]!.fields['function'] = 'my-lib/outer'
    const out2 = generateGraphClasses({ modId: 'M', swfCls: 'T', graphs: [main], packs: cg, layerPath: () => undefined })
    expect(out2.issues).toEqual([])
    expect(out2.classes.map((c) => c.graphId)).toEqual(['main', 'my-lib/outer', 'my-lib/inner'])
    expect(out2.classes.filter((c) => c.fn).map((c) => c.cls)).toEqual(['TGraph_my_lib_outer', 'TGraph_my_lib_inner'])
    const outerSrc = out2.classes[1]!.source
    expect(outerSrc).toContain('new mods.M.TGraph_my_lib_inner(__g.base, __g, {')
    // validation sees the library function
    const errs = validateGraph(main, { defs: packs.defs, library: cg.functions! }).filter((x) => x.code === 'graph-function')
    expect(errs).toEqual([])
    const missing = validateGraph(main, { defs: packs.defs }).filter((x) => x.code === 'graph-function')
    expect(missing[0]?.message).toContain('not installed')
  })

  it('imports a folder too; an existing id is only replaced on request; core is refused; remove deletes it', async () => {
    const { inner, outer } = project()
    const e = await exportLibrary(base(tmp(), ['inner'], [inner, outer]))
    if (!e.ok) throw new Error(e.error)
    const projectDir = tmp()
    expect((await importLibrary(projectDir, e.folder)).ok).toBe(true)
    expect(await importLibrary(projectDir, e.folder)).toEqual({ ok: false, error: expect.stringContaining('already'), exists: true })
    expect((await importLibrary(projectDir, e.folder, { replace: true })).ok).toBe(true)
    await removeLibrary(projectDir, 'my-lib')
    expect(await localLibraryDirs(projectDir)).toEqual([])
    const bad = await importLibrary(projectDir, join(tmp(), 'nothing'))
    expect(bad.ok).toBe(false)
  })
})
