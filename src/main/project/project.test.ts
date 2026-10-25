import { SPEC_VERSION } from '@inkwell-ui/spec'
import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProject, saveProject, stableStringify } from './index'

const sample = resolve(__dirname, '../../../samples/hud-minimal')
const tmp = () => mkdtemp(join(tmpdir(), 'inkwell-'))
// a running editor pointed at the sample writes extra swf folders and build/ into it; only the committed `hud` swf is test data
const sampleFilter = (src: string) => {
  const rel = src.slice(sample.length).split('\\').join('/').replace(/^\//, '')
  return !(rel === 'build' || rel.startsWith('build/') || (/^swfs\/[^/]+/.test(rel) && !/^swfs\/hud(\/|$)/.test(rel)))
}

async function files(dir: string, rel = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) { if (p !== 'build') Object.assign(out, await files(dir, p)) } // build/ is git-ignored compiler output, not project data
    else out[p] = await readFile(join(dir, p), 'utf8')
  }
  return out
}

describe('project format', () => {
  it('stableStringify sorts keys, indents 2, ends with newline', () => {
    expect(stableStringify({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).toBe(
      '{\n  "a": {\n    "c": null,\n    "d": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n'
    )
  })

  it('golden round-trip: sample saves back byte-identical', async () => {
    const out = await tmp()
    const src = await tmp() // the committed sample only (see sampleFilter)
    await cp(sample, src, { recursive: true, filter: sampleFilter })
    await saveProject(out, await loadProject(src))
    const a = await files(src)
    const b = await files(out)
    delete a['figma/.gitkeep']
    delete a['shared/.gitkeep']
    delete a['.gitignore'] // not part of the project format (createProject writes it once)
    delete a['figma/snapshot.json'] // written by the sync (snapshot.ts), not by saveProject
    expect(b).toEqual(a)
  })

  it('preserves unknown keys and is stable on re-save', async () => {
    const dir = await tmp()
    await cp(sample, dir, { recursive: true, filter: sampleFilter })
    const p = await loadProject(dir)
    expect(p.meta['x-unknown']).toBe(true)
    expect(p.swfs['hud']?.ir['extra']).toEqual({ fromFuturePack: { a: 1 } })
    await saveProject(dir, p)
    const first = await files(dir)
    await saveProject(dir, await loadProject(dir))
    expect(await files(dir)).toEqual(first)
  })

  it('opens a v1 project through the spec migration', async () => {
    const dir = await tmp()
    await cp(sample, dir, { recursive: true, filter: sampleFilter })
    const f = join(dir, 'swfs/hud/ir.json')
    const ir = JSON.parse(await readFile(f, 'utf8'))
    ir.specVersion = 1
    const { align, verticalAlign, ...label } = ir.nodes['1:3']
    ir.nodes['1:3'] = { ...label, extra: { text: { align, verticalAlign } } }
    await writeFile(f, JSON.stringify(ir))
    const loaded = (await loadProject(dir)).swfs['hud']!.ir as any
    expect(loaded.specVersion).toBe(SPEC_VERSION)
    expect(loaded.nodes['1:3']).toMatchObject({ align: 'center', verticalAlign: 'center' })
    expect(loaded.nodes['1:3'].extra).toBeUndefined()
    expect(loaded.extra).toEqual({ fromFuturePack: { a: 1 } })
  })

  it('save deletes swf folders no longer in the project', async () => {
    const dir = await tmp()
    await cp(sample, dir, { recursive: true, filter: sampleFilter })
    const p = await loadProject(dir)
    p.swfs['gone'] = p.swfs['hud']!
    await saveProject(dir, p)
    expect(Object.keys((await loadProject(dir)).swfs).sort()).toEqual(['gone', 'hud'])
    delete p.swfs['gone']
    await saveProject(dir, p)
    expect(Object.keys((await loadProject(dir)).swfs)).toEqual(['hud'])
  })

  it('rejects invalid project.json', async () => {
    const dir = await tmp()
    await writeFile(join(dir, 'project.json'), '{"name":1}')
    await expect(loadProject(dir)).rejects.toThrow()
  })
})
