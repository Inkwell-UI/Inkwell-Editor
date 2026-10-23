import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProject, saveProject, stableStringify } from './index'

const sample = resolve(__dirname, '../../../samples/hud-minimal')
const tmp = () => mkdtemp(join(tmpdir(), 'inkwell-'))

async function files(dir: string, rel = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) Object.assign(out, await files(dir, p))
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
    await saveProject(out, await loadProject(sample))
    const a = await files(sample)
    const b = await files(out)
    delete a['figma/.gitkeep']
    delete a['shared/.gitkeep']
    expect(b).toEqual(a)
  })

  it('preserves unknown keys and is stable on re-save', async () => {
    const dir = await tmp()
    await cp(sample, dir, { recursive: true })
    const p = await loadProject(dir)
    expect(p.meta['x-unknown']).toBe(true)
    expect(p.swfs['hud']?.ir['extra']).toEqual({ fromFuturePack: { a: 1 } })
    await saveProject(dir, p)
    const first = await files(dir)
    await saveProject(dir, await loadProject(dir))
    expect(await files(dir)).toEqual(first)
  })

  it('rejects invalid project.json', async () => {
    const dir = await tmp()
    await writeFile(join(dir, 'project.json'), '{"name":1}')
    await expect(loadProject(dir)).rejects.toThrow()
  })
})
