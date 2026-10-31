import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
import { loadPack } from './index'
import { addFunctionToLibrary, createLibrary, exportPack, importLibrary, isImportedPack, localLibraryDirs, removeLibrary, removeLibraryFunction } from './libraries'

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
/** A project with the pack "my-lib" holding inner (id 0, the pack numbers its functions) and outer (id 1, calls my-lib/0), made the way the editor does: create, then add each function. */
async function packed() {
  const { inner, outer } = project()
  const projectDir = tmp()
  expect((await createLibrary(projectDir, { id: 'my-lib', version: '1.0.0', description: 'Helpers' }, '0.5.0')).ok).toBe(true)
  const q = { ...outer, nodes: outer.nodes.map((x) => (x.id === 'c' ? { ...x, fields: { ...x.fields, function: 'my-lib/0' } } : x)) } as Graph
  expect((await addFunctionToLibrary(projectDir, 'my-lib', inner)).ok).toBe(true)
  expect((await addFunctionToLibrary(projectDir, 'my-lib', q)).ok).toBe(true)
  return { projectDir, inner, outer }
}
const exp = async (projectDir: string, over: Record<string, unknown> = {}) => {
  const { packs: cg } = await loadCodegenPacks([corePack, ...(await localLibraryDirs(projectDir))])
  return exportPack({ projectDir, packId: 'my-lib', defs: packs.defs, library: cg.functions ?? new Map(), packVersions: new Map([['core', '0.5.5']]), toolVersion: '0.5.0', outDir: tmp(), ...over })
}

describe('createLibrary and addFunctionToLibrary', () => {
  it('makes an empty pack the loader accepts, refuses bad ids, versions and duplicates', async () => {
    const dir = tmp()
    expect((await createLibrary(dir, { id: 'a-pack', version: '1.0.0' }, '0.5.0')).ok).toBe(true)
    const [d] = await localLibraryDirs(dir)
    expect((await loadPack(d!)).problems).toEqual([])
    expect(((await createLibrary(dir, { id: 'a-pack', version: '1.0.0' }, '0.5.0')) as { error: string }).error).toContain('already')
    expect(((await createLibrary(dir, { id: 'core', version: '1.0.0' }, '0.5.0')) as { error: string }).error).toContain('core')
    expect(((await createLibrary(dir, { id: 'Bad Id', version: '1.0.0' }, '0.5.0')) as { error: string }).error).toContain('lower-case')
    expect(((await createLibrary(dir, { id: 'x', version: '1.0' }, '0.5.0')) as { error: string }).error).toContain('1.0.0')
  })

  it('refuses a function that calls a project function, naming it, or the pack numbers its functions, so the same project id never clashes', async () => {
    const { outer } = project()
    const dir = tmp()
    await createLibrary(dir, { id: 'my-lib', version: '1.0.0' }, '0.5.0')
    expect(((await addFunctionToLibrary(dir, 'my-lib', outer)) as { error: string }).error).toContain('"inner"')
    const { inner } = project()
    expect(await addFunctionToLibrary(dir, 'my-lib', inner)).toEqual({ ok: true, id: '0' })
    expect(await addFunctionToLibrary(dir, 'my-lib', inner)).toEqual({ ok: true, id: '1' }) // same project id, the next free number of the pack
  })
})

describe('exportPack', () => {
  it('writes the pack folder and a zip, with dependencies recomputed and the new version written back', async () => {
    const { projectDir } = await packed()
    const r = await exp(projectDir, { version: '1.1.0' })
    if (!r.ok) throw new Error(r.error)
    expect(r.dependencies).toEqual({ core: '^0.5.5' })
    const manifest = JSON.parse(readFileSync(join(r.folder, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({ id: 'my-lib', version: '1.1.0', compatible: { tool: '^0.5.0' }, extra: { description: 'Helpers' } })
    expect(JSON.parse(readFileSync(join(projectDir, 'libraries/my-lib/manifest.json'), 'utf8')).version).toBe('1.1.0')
    expect(existsSync(join(r.folder, 'functions/1.json'))).toBe(true)
    expect(r.zip.endsWith('my-lib-1.1.0.zip')).toBe(true)
    expect(existsSync(r.zip)).toBe(true)
  })

  it('refuses an empty pack, a bad version, an unknown pack and a function with errors', async () => {
    const dir = tmp()
    await createLibrary(dir, { id: 'my-lib', version: '1.0.0' }, '0.5.0')
    expect(((await exp(dir)) as { error: string }).error).toContain('empty')
    const { projectDir, inner } = await packed()
    expect(((await exp(projectDir, { version: '1.0' })) as { error: string }).error).toContain('1.0.0')
    expect((await exp(projectDir, { packId: 'nope' })).ok).toBe(false)
    const broken = { ...inner, nodes: inner.nodes.filter((x) => !x.kind.includes('FunctionEntry')) }
    writeFileSync(join(projectDir, 'libraries/my-lib/functions/0.json'), JSON.stringify({ ...broken, id: '0' }))
    expect(((await exp(projectDir)) as { error: string }).error).toContain('has errors')
  })
})

describe('importLibrary and the loader', () => {
  it('imports an exported zip into libraries/, the functions load as <pack>/<id>, and a caller compiles them', async () => {
    const e = await exp((await packed()).projectDir)
    if (!e.ok) throw new Error(e.error)
    const projectDir = tmp()
    const r = await importLibrary(projectDir, e.zip)
    expect(r).toEqual({ ok: true, id: 'my-lib', version: '1.0.0', functions: ['0', '1'], nodes: 0 })
    const dirs = await localLibraryDirs(projectDir)
    expect(dirs).toHaveLength(1)
    const { packs: cg, problems } = await loadCodegenPacks([corePack, ...dirs])
    expect(problems).toEqual([])
    expect([...cg.functions!.keys()].sort()).toEqual(['my-lib/0', 'my-lib/1'])
    // a menu graph calls the library function; only the functions it reaches are compiled in, with the library calls resolved
    const lib = cg.functions!.get('my-lib/1')!
    const main = graph('main', [node('ol', 'core/OnLoad@1'), node('c', 'core/CallFunction@1', callFields({ ...lib, id: 'my-lib/1' } as Graph))], [wire('ol', 'then', 'c', 'in')])
    main.nodes[1]!.fields['function'] = 'my-lib/1'
    const out2 = generateGraphClasses({ modId: 'M', swfCls: 'T', graphs: [main], packs: cg, layerPath: () => undefined })
    expect(out2.issues).toEqual([])
    expect(out2.classes.map((c) => c.graphId)).toEqual(['main', 'my-lib/1', 'my-lib/0'])
    expect(out2.classes.filter((c) => c.fn).map((c) => c.cls)).toEqual(['TGraph_my_lib_1', 'TGraph_my_lib_0'])
    const outerSrc = out2.classes[1]!.source
    expect(outerSrc).toContain('new mods.M.TGraph_my_lib_0(__g.base, __g, {')
    // validation sees the library function
    const errs = validateGraph(main, { defs: packs.defs, library: cg.functions! }).filter((x) => x.code === 'graph-function')
    expect(errs).toEqual([])
    const missing = validateGraph(main, { defs: packs.defs }).filter((x) => x.code === 'graph-function')
    expect(missing[0]?.message).toContain('not installed')
  })

  it('imports a folder too; an existing id is only replaced on request; core is refused; remove deletes it', async () => {
    const e = await exp((await packed()).projectDir)
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

describe('imported packs are immutable', () => {
  it('an imported pack is marked, and adding, deleting and exporting its functions is refused; a local pack is not marked', async () => {
    const local = await packed()
    expect(isImportedPack(join(local.projectDir, 'libraries/my-lib'))).toBe(false)
    const e = await exp(local.projectDir)
    if (!e.ok) throw new Error(e.error)
    const dir = tmp()
    expect((await importLibrary(dir, e.zip)).ok).toBe(true)
    expect(isImportedPack(join(dir, 'libraries/my-lib'))).toBe(true)
    expect(((await addFunctionToLibrary(dir, 'my-lib', project().inner)) as { error: string }).error).toContain('imported')
    expect(((await removeLibraryFunction(dir, 'my-lib', '0')) as { error: string }).error).toContain('imported')
    expect(((await exp(dir)) as { error: string }).error).toContain('imported')
    expect((await removeLibraryFunction(local.projectDir, 'my-lib', '0')).ok).toBe(true)
  })
})
