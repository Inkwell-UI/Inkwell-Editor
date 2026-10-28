import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COMPONENT_TREES_DIR, readComponentTrees, writeComponentTrees } from './componentTrees'
import { frame, rectShape } from '../swf/ir.testutil'

let dir = ''
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'inkwell-ctree-'))))
afterEach(() => rm(dir, { recursive: true, force: true }))

const tree = (id: string, name: string) => ({ id, name, nodes: { [id]: { ...frame(id, ['c']), type: 'component' as const, variants: [] }, c: { ...rectShape('c'), parent: id } } as never })

describe('component trees on disk', () => {
  it('written, read back, and the folder follows the plugin: a component that is gone loses its file', async () => {
    await writeComponentTrees(dir, [tree('5:1', 'ListItem'), tree('6:1', 'Button')])
    expect((await readComponentTrees(dir)).map((t) => [t.id, t.name, Object.keys(t.nodes).length])).toEqual([['5:1', 'ListItem', 2], ['6:1', 'Button', 2]])
    await writeComponentTrees(dir, [tree('5:1', 'ListItem')])
    expect(await readdir(join(dir, ...COMPONENT_TREES_DIR))).toEqual(['5-1.json'])
  })
  it('nothing on disk: no trees; an unreadable file is skipped', async () => {
    expect(await readComponentTrees(dir)).toEqual([])
  })
})
