import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyGraph } from '../../shared/graphs'
import { deleteGraph, graphText, parseGraph, readGraph, readGraphs, writeGraph } from './graphFiles'
import { loadProject, saveProject } from './index'

const fixture = resolve(__dirname, '../../../tests/fixtures/graphs/menu.json')
const sample = resolve(__dirname, '../../../samples/hud-minimal')
const tmp = () => mkdtemp(join(tmpdir(), 'inkwell-graphs-'))
const put = async (project: string, swf: string, id: string, text: string) => {
  await mkdir(join(project, 'swfs', swf, 'graphs'), { recursive: true })
  await writeFile(join(project, 'swfs', swf, 'graphs', `${id}.json`), text)
}

describe('graph files', () => {
  it('golden round-trip: the fixture saves back byte-identical', async () => {
    const text = await readFile(fixture, 'utf8')
    expect(graphText(parseGraph(text))).toBe(text)
    const dir = await tmp()
    await put(dir, 'hud', 'menu', text)
    const r = await readGraph(dir, 'hud', 'menu')
    if (!r.ok) throw new Error(r.error)
    expect(await writeGraph(dir, 'hud', r.graph)).toEqual({ ok: true })
    expect(await readFile(join(dir, 'swfs/hud/graphs/menu.json'), 'utf8')).toBe(text)
  })

  it('keeps unknown keys at every level and nodes of packs that are not installed', async () => {
    const g = parseGraph(await readFile(fixture, 'utf8'))
    expect(g['futureTop']).toEqual({ a: 1, b: 2 })
    expect(g.nodes[0]!['futureNode']).toBe(true)
    expect(g.nodes[0]!.pos['z']).toBe(3)
    expect(g.nodes[3]).toMatchObject({ kind: 'other/Mystery@2', mystery: { k: 'v' }, fields: { alpha: [1, 2], zeta: 1 } })
    expect(g.variables[0]!['futureVar']).toBe(1)
    expect(g.edges[1]!.extra).toEqual({ e: 1 })
  })

  it('a graph node that targets a deleted layer stays in the file (orphan, never dropped)', async () => {
    const dir = await tmp()
    await put(dir, 'hud', 'menu', await readFile(fixture, 'utf8'))
    const r = await readGraph(dir, 'hud', 'menu')
    if (!r.ok) throw new Error(r.error)
    await writeGraph(dir, 'hud', r.graph) // the layer 1:2 is not in the IR; saving never removes the node
    const again = await readGraph(dir, 'hud', 'menu')
    expect(again.ok && again.graph.nodes.find((n) => n.id === 'n2')?.fields['target']).toBe('1:2')
  })

  it('creates, lists and deletes; refuses ids and swf names that could escape the folder', async () => {
    const dir = await tmp()
    expect(await writeGraph(dir, 'hud', emptyGraph('title', 'Title', 'component'))).toEqual({ ok: true })
    expect((await readGraphs(dir, 'hud')).graphs.map((g) => g.id)).toEqual(['title'])
    expect(await writeGraph(dir, 'hud', emptyGraph('../evil', 'x', 'menu'))).toMatchObject({ ok: false })
    expect(await writeGraph(dir, '..', emptyGraph('a', 'x', 'menu'))).toMatchObject({ ok: false })
    expect(await readGraph(dir, 'hud', 'a/b')).toMatchObject({ ok: false })
    expect(await deleteGraph(dir, 'hud', 'title')).toEqual({ ok: true })
    expect((await readGraphs(dir, 'hud')).graphs).toEqual([])
  })

  it('reports an unreadable graph file and leaves it on disk', async () => {
    const dir = await tmp()
    await put(dir, 'hud', 'bad', '{ not json')
    await put(dir, 'hud', 'wrongid', graphText(emptyGraph('other', 'O', 'menu')))
    const r = await readGraphs(dir, 'hud')
    expect(r.graphs).toEqual([])
    expect(r.problems).toHaveLength(2)
    expect(await readdir(join(dir, 'swfs/hud/graphs'))).toEqual(['bad.json', 'wrongid.json'])
  })

  it('loadProject / saveProject carry graphs and re-save them unchanged', async () => {
    const dir = await tmp()
    await cp(sample, dir, { recursive: true, filter: (s) => !/[\/]build([\/]|$)/.test(s) && !/swfs[\/](?!hud([\/]|$))/.test(s) })
    const text = await readFile(fixture, 'utf8')
    await put(dir, 'hud', 'menu', text)
    const p = await loadProject(dir)
    expect(Object.keys(p.swfs['hud']!.graphs ?? {})).toEqual(['menu'])
    await saveProject(dir, p)
    expect(await readFile(join(dir, 'swfs/hud/graphs/menu.json'), 'utf8')).toBe(text)
  })
})
