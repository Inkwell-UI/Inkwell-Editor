import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { newComponentGraph } from '../../shared/graphs'
import { frame, rectShape } from '../swf/ir.testutil'
import { writeComponentGraph } from './componentFiles'
import { loadComponentSources } from './componentSources'
import { writeComponentTrees } from './componentTrees'

let dir = ''
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'inkwell-csrc-'))))
afterEach(() => rm(dir, { recursive: true, force: true }))

const tree = (id: string, name: string) => ({ id, name, nodes: { [id]: { ...frame(id, ['c']), type: 'component' as const, variants: [] }, c: { ...rectShape('c'), parent: id } } as never })

describe('loadComponentSources', () => {
  it('only the components that have a graph are compiled', async () => {
    await writeComponentTrees(dir, [tree('5:1', 'ListItem'), tree('6:1', 'Button')])
    await writeComponentGraph(dir, newComponentGraph('5:1', 'ListItem'))
    const r = await loadComponentSources(dir)
    expect(r.sources.map((s) => s.id)).toEqual(['5:1'])
    expect(r.graphs.map((g) => g.component)).toEqual(['5:1'])
  })
  it('an empty project: nothing', async () => expect(await loadComponentSources(dir)).toEqual({ sources: [], graphs: [] }))
})

describe('Get Prop copies', () => {
  it('a graph saved before the node kept its prop name is read with the name filled in', async () => {
    const g = { ...newComponentGraph('5:1', 'ListItem'), props: [{ id: 'p', name: 'label', type: 'String' as const }], nodes: [{ id: 'g', kind: 'core/GetProp@1', fields: { prop: 'p' }, pos: { x: 0, y: 0 } }] }
    await writeComponentTrees(dir, [tree('5:1', 'ListItem')])
    await writeComponentGraph(dir, g)
    expect((await loadComponentSources(dir)).graphs[0]!.nodes[0]!.fields).toMatchObject({ prop: 'p', propName: 'label', propType: 'String' })
  })
})
