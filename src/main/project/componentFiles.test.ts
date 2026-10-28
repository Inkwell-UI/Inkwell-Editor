import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { newComponentGraph } from '../../shared/graphs'
import { componentGraphExists, componentSlug, deleteComponentGraph, readComponentGraphs, writeComponentGraph } from './componentFiles'

let dir = ''
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'inkwell-comp-'))))
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('component graph files', () => {
  it('a Figma id becomes a file-safe name', () => expect(componentSlug('36:5')).toBe('36-5'))

  it('write, list, delete', async () => {
    const g = { ...newComponentGraph('36:5', 'ListItem'), props: [{ id: 'p', name: 'label', type: 'String' as const, default: '' }] }
    expect(await writeComponentGraph(dir, g)).toEqual({ ok: true })
    expect(await componentGraphExists(dir, '36:5')).toBe(true)
    const r = await readComponentGraphs(dir)
    expect(r.problems).toEqual([])
    expect(r.graphs).toMatchObject([{ component: '36:5', name: 'ListItem', props: [{ name: 'label' }] }])
    expect(await deleteComponentGraph(dir, '36:5')).toEqual({ ok: true })
    expect((await readComponentGraphs(dir)).graphs).toEqual([])
  })

  it('refuses a graph that is not a component graph', async () => {
    expect(await writeComponentGraph(dir, { ...newComponentGraph('1:1', 'A'), scope: 'menu' })).toMatchObject({ ok: false })
    expect(await writeComponentGraph(dir, { nope: 1 })).toMatchObject({ ok: false })
  })
})
