import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defIndex } from '../../shared/graphs'
import { TOOL_VERSION } from '../../shared/product'
import { corePackDir, loadPack, loadPacks } from './index'

const fixture = resolve(__dirname, '../../../tests/fixtures/packs/test-pack')

describe('pack loader', () => {
  it('reads the manifest and node definitions, validated with the Spec schemas', async () => {
    const r = await loadPack(fixture)
    expect(r.pack!.manifest).toMatchObject({ id: 'core', version: '0.2.0', extra: { note: expect.any(String) } })
    expect(r.pack!.nodes.map((n) => n.kind)).toEqual(['Add', 'Branch', 'CallWidget', 'Comment', 'Log', 'OnClick', 'OnWidgetCall', 'SetText'])
    expect(r.pack!.nodes.find((n) => n.kind === 'OnWidgetCall')!.extra).toMatchObject({ entry: true })
  })

  it('skips a node file that fails its schema and says which; the rest of the pack loads', async () => {
    const r = await loadPack(fixture)
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toContain('Broken.json')
  })

  it("refuses a pack built for another Inkwell version, in plain words, and loads no nodes (compatible.tool)", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inkwell-pack-'))
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ id: 'later', version: '1.0.0', compatible: { tool: '^0.7.0' } }))
    const r = await loadPack(dir)
    expect(r.pack).toBeUndefined()
    expect(r.problems[0]).toBe(`later@1.0.0: built for Inkwell ^0.7.0; this is ${TOOL_VERSION}. Update Inkwell or the pack.`)
  })

  it("TOOL_VERSION is the version in package.json, and the bundled core pack accepts it", async () => {
    expect(TOOL_VERSION).toBe(JSON.parse(await readFile(resolve(__dirname, '../../../package.json'), 'utf8')).version)
    expect((await loadPack(corePackDir(resolve(__dirname, '../../..')))).problems).toEqual([])
  })

  it('indexes definitions by packId/kind@major', async () => {
    const set = await loadPacks([fixture])
    expect([...defIndex(set).keys()]).toContain('core/SetText@1')
  })

  it('a missing or invalid pack is a problem, never a throw; a pack id loads once', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'inkwell-pack-'))
    expect((await loadPacks([empty])).problems[0]).toContain('manifest.json')
    await writeFile(join(empty, 'manifest.json'), '{"id":"Bad Id"}')
    expect((await loadPacks([empty])).packs).toEqual([])
    const twice = await loadPacks([fixture, fixture])
    expect(twice.packs).toHaveLength(1)
    expect(twice.problems.some((p) => p.includes('already loaded'))).toBe(true)
  })

  it('the core pack folder is configurable', () => {
    expect(corePackDir('/app', {})).toBe(join('/app', 'resources/packs/core'))
    expect(corePackDir('/app', { INKWELL_CORE_PACK: '/x/core' })).toBe('/x/core')
  })
})
