import type { Graph } from '@inkwell-ui/spec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyGraph, newGraphId, summarize } from '../../shared/graphs'
import { mockDataOf, withMockData } from '../../shared/graphBinding'
import { addGraph, loadSwfGraphs, menuGraphId, removeGraph, renameGraph, resetGraphDocs, useGraphDocs } from './graphDocs'
import { findGraphStore, flushGraphSaves, setGraphSaver } from './graphStore'
import { editNode, editOverlay, getOverlayDoc, getOverlayStore, redoSwf, resetOverlays, setOverlaySaver, undoSwf } from './overlayStore'

/** A fake of the four graph IPC calls over an in-memory "disk" (the real ones are tested in main). */
function fakeApi(initial: Graph[] = []) {
  const disk = new Map(initial.map((g) => [g.id, g]))
  return {
    disk,
    listGraphs: vi.fn(async () => ({ ok: true as const, graphs: [...disk.values()].map(summarize) })),
    loadGraph: vi.fn(async (_s: string, id: string) => ({ ok: true as const, graph: disk.get(id)! })),
    createGraph: vi.fn(async (_s: string, name: string, scope: Graph['scope']) => {
      if (scope === 'menu' && [...disk.values()].some((g) => g.scope === 'menu')) return { ok: false as const, error: 'The SWF already has a menu graph' }
      const g = emptyGraph(newGraphId(name, new Set(disk.keys())), name, scope)
      disk.set(g.id, g)
      return { ok: true as const, graph: g }
    }),
    deleteGraph: vi.fn(async (_s: string, id: string) => (disk.delete(id) ? { ok: true as const } : { ok: false as const, error: 'No such graph' }))
  }
}
const swf = { id: 'swf', name: 'Hud', root: 'root' }
const scripts = (id: string): unknown => getOverlayDoc('swf')?.nodes?.[id]?.['scripts']

beforeEach(() => {
  vi.useFakeTimers()
  resetGraphDocs()
  resetOverlays()
  setOverlaySaver(undefined)
  setGraphSaver(undefined)
  getOverlayStore('swf', 'Hud', { specVersion: 5, nodes: {} })
})
afterEach(() => vi.useRealTimers())

describe('graph list actions', () => {
  it('loads the SWF once and opens the menu graph first', async () => {
    const api = fakeApi([emptyGraph('comp', 'Comp', 'component'), emptyGraph('main', 'Main', 'menu')])
    await Promise.all([loadSwfGraphs(swf, api), loadSwfGraphs(swf, api)])
    await loadSwfGraphs(swf, api)
    expect(api.listGraphs).toHaveBeenCalledTimes(1)
    expect(useGraphDocs.getState().ids['swf']).toEqual(['comp', 'main'])
    expect(useGraphDocs.getState().active['swf']).toBe('main')
    expect(menuGraphId('swf')).toBe('main')
  })

  it('[+ Graph]: the menu graph when none exists (attached to the frame), then component graphs (attached to the selected layer)', async () => {
    const api = fakeApi()
    await loadSwfGraphs(swf, api)
    const name = (s: Graph['scope']) => (s === 'menu' ? 'Hud' : 'Title')
    const first = await addGraph({ swf, overlay: getOverlayDoc('swf'), component: '2:4', name }, api)
    expect(first).toEqual({ ok: true, id: 'hud' })
    expect(api.createGraph).toHaveBeenLastCalledWith('Hud', 'Hud', 'menu')
    expect(scripts('root')).toEqual(['hud'])
    expect(scripts('2:4')).toBeUndefined()
    const second = await addGraph({ swf, overlay: getOverlayDoc('swf'), component: '2:4', name }, api)
    expect(second).toEqual({ ok: true, id: 'title' })
    expect(api.createGraph).toHaveBeenLastCalledWith('Hud', 'Title', 'component')
    expect(scripts('2:4')).toEqual(['title'])
    expect(useGraphDocs.getState().ids['swf']).toEqual(['hud', 'title'])
    expect(useGraphDocs.getState().active['swf']).toBe('title')
    expect(findGraphStore('swf', 'title')).toBeTruthy()
    // a component graph without a selection hangs off the frame; a second one for the same layer is appended
    await addGraph({ swf, overlay: getOverlayDoc('swf'), component: '2:4', name: () => 'Title' }, api)
    expect(scripts('2:4')).toEqual(['title', 'title-2'])
  })

  it('attaching is a history entry of the SWF: undo takes the scripts entry away again', async () => {
    const api = fakeApi()
    await loadSwfGraphs(swf, api)
    await addGraph({ swf, overlay: getOverlayDoc('swf'), component: undefined, name: () => 'Hud' }, api)
    expect(scripts('root')).toEqual(['hud'])
    undoSwf('swf')
    expect(scripts('root')).toBeUndefined()
    redoSwf('swf')
    expect(scripts('root')).toEqual(['hud'])
  })

  it('reports a refused create without touching the overlay', async () => {
    const api = fakeApi([emptyGraph('main', 'Main', 'menu')])
    await loadSwfGraphs(swf, api)
    api.createGraph.mockResolvedValueOnce({ ok: false, error: 'disk full' } as never)
    expect(await addGraph({ swf, overlay: getOverlayDoc('swf'), component: undefined, name: () => 'X' }, api)).toEqual({ ok: false, error: 'disk full' })
    expect(getOverlayDoc('swf')?.nodes).toEqual({})
  })

  it('delete removes the file, the store, its history entries and every scripts reference; a late save cannot bring it back', async () => {
    const api = fakeApi()
    const saved: string[] = []
    setGraphSaver((_n, g) => void saved.push(g.id))
    await loadSwfGraphs(swf, api)
    const name = (s: Graph['scope']) => (s === 'menu' ? 'Hud' : 'Title')
    await addGraph({ swf, overlay: getOverlayDoc('swf'), component: '2:4', name }, api)
    await addGraph({ swf, overlay: getOverlayDoc('swf'), component: '2:4', name }, api)
    findGraphStore('swf', 'title')!.getState().addVariable({ id: 'v', name: 'v', type: 'Bool' }) // pending save + history entry
    editNode('swf', '2:5', { scripts: ['title', 'hud'] })
    const r = await removeGraph({ swf, overlay: getOverlayDoc('swf'), graphId: 'title' }, api)
    expect(r).toEqual({ ok: true })
    expect(api.disk.has('title')).toBe(false)
    expect(findGraphStore('swf', 'title')).toBeUndefined()
    expect(scripts('2:4')).toBeUndefined()
    expect(scripts('2:5')).toEqual(['hud'])
    expect(useGraphDocs.getState().ids['swf']).toEqual(['hud'])
    expect(useGraphDocs.getState().active['swf']).toBe('hud')
    vi.advanceTimersByTime(2000)
    flushGraphSaves()
    expect(saved).not.toContain('title')
    for (let i = 0; i < 6; i++) undoSwf('swf') // never touches the deleted graph
    expect(findGraphStore('swf', 'title')).toBeUndefined()
  })

  it('rename is an undoable edit saved with the graph', async () => {
    const api = fakeApi([emptyGraph('main', 'Main', 'menu')])
    const saved: string[] = []
    setGraphSaver((_n, g) => void saved.push(g.name))
    await loadSwfGraphs(swf, api)
    renameGraph('swf', 'main', 'Inventory')
    expect(findGraphStore('swf', 'main')!.getState().name).toBe('Inventory')
    vi.advanceTimersByTime(1000)
    expect(saved).toEqual(['Inventory'])
    undoSwf('swf')
    expect(findGraphStore('swf', 'main')!.getState().name).toBe('Main')
  })
})

describe('binding and mock data edits join the SWF history', () => {
  it('a binding is one editNode entry; a mock data edit is one overlay entry; both undo in order', () => {
    editNode('swf', '2:4', { dataBinding: 'text=mock:title' })
    editOverlay('swf', (d) => withMockData(d, { title: 'Hello' }))
    expect(getOverlayDoc('swf')?.nodes?.['2:4']?.['dataBinding']).toBe('text=mock:title')
    expect(mockDataOf(getOverlayDoc('swf'))).toEqual({ title: 'Hello' })
    undoSwf('swf')
    expect(mockDataOf(getOverlayDoc('swf'))).toEqual({})
    expect(getOverlayDoc('swf')?.nodes?.['2:4']?.['dataBinding']).toBe('text=mock:title')
    undoSwf('swf')
    expect(getOverlayDoc('swf')?.nodes).toEqual({})
  })
})
