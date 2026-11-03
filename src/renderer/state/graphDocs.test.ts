import type { Graph } from '@inkwell-ui/spec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyGraph, newGraphId, summarize } from '../../shared/graphs'
import { mockDataOf, withMockData } from '../../shared/graphBinding'
import { layerGraphChange, loadSwfGraphs, menuGraphId, openLayerGraph, removeGraph, renameGraph, resetGraphDocs, useGraphDocs } from './graphDocs'
import { findGraphStore, flushGraphSaves, setBlankHandlers, setGraphSaver } from './graphStore'
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
let removed: string[] = []
const node = (id = 'n1') => ({ id, kind: 'core/OnLoad@1', pos: { x: 0, y: 0 } })

beforeEach(() => {
  vi.useFakeTimers()
  resetGraphDocs()
  resetOverlays()
  setOverlaySaver(undefined)
  setGraphSaver(undefined)
  removed = []
  setBlankHandlers({ change: layerGraphChange, remove: (_n, id) => void removed.push(id) })
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

  it('a layer with no graph opens a blank canvas: not listed, not attached, never saved', async () => {
    const api = fakeApi()
    const saved: string[] = []
    setGraphSaver((_n, g) => void saved.push(g.id))
    await loadSwfGraphs(swf, api)
    const id = openLayerGraph(swf, '2:4', 'Title')
    expect(id).toBe('title')
    expect(useGraphDocs.getState().active['swf']).toBe('title')
    expect(findGraphStore('swf', 'title')).toBeTruthy()
    expect(useGraphDocs.getState().ids['swf']).toEqual([])
    expect(openLayerGraph(swf, '2:4', 'Title')).toBe('title') // the same canvas again
    vi.advanceTimersByTime(2000)
    expect(saved).toEqual([])
    expect(removed).toEqual([])
    expect(scripts('2:4')).toBeUndefined()
  })

  it('the frame is the menu graph (one per SWF); every other layer gets a layer graph', async () => {
    await loadSwfGraphs(swf, fakeApi())
    openLayerGraph(swf, 'root', 'ignored')
    expect(findGraphStore('swf', 'hud')!.getState().meta.scope).toBe('menu')
    openLayerGraph(swf, '2:4', 'Title')
    expect(findGraphStore('swf', 'title')!.getState().meta.scope).toBe('component')
  })

  it('the first node lists, attaches and saves the graph, in one undo step', async () => {
    await loadSwfGraphs(swf, fakeApi())
    const saved: string[] = []
    setGraphSaver((_n, g) => void saved.push(g.id))
    openLayerGraph(swf, '2:4', 'Title')
    findGraphStore('swf', 'title')!.getState().addNode(node())
    expect(useGraphDocs.getState().ids['swf']).toEqual(['title'])
    expect(scripts('2:4')).toEqual(['title'])
    vi.advanceTimersByTime(1000)
    expect(saved).toEqual(['title'])
    undoSwf('swf') // one step takes the node, the listing and the attachment away
    expect(findGraphStore('swf', 'title')!.getState().nodes).toHaveLength(0)
    expect(scripts('2:4')).toBeUndefined()
    expect(useGraphDocs.getState().ids['swf']).toEqual([])
    redoSwf('swf')
    expect(scripts('2:4')).toEqual(['title'])
    expect(useGraphDocs.getState().ids['swf']).toEqual(['title'])
  })

  it('a variable is content too: the graph is kept', async () => {
    await loadSwfGraphs(swf, fakeApi())
    openLayerGraph(swf, '2:4', 'Title')
    findGraphStore('swf', 'title')!.getState().addVariable({ id: 'v', name: 'v', type: 'Bool' })
    expect(scripts('2:4')).toEqual(['title'])
  })

  it('emptying a saved graph removes its file and detaches the layer; undo brings both back', async () => {
    const g = { ...emptyGraph('title', 'Title', 'component'), nodes: [{ id: 'n1', kind: 'core/OnLoad@1', fields: {}, pos: { x: 0, y: 0 } }] }
    await loadSwfGraphs(swf, fakeApi([g]))
    editNode('swf', '2:4', { scripts: ['title'] })
    const saved: string[] = []
    setGraphSaver((_n, x) => void saved.push(x.id))
    openLayerGraph(swf, '2:4', 'Title')
    const store = findGraphStore('swf', 'title')!
    store.getState().deleteSelection(['n1'], [])
    expect(scripts('2:4')).toBeUndefined()
    expect(useGraphDocs.getState().ids['swf']).toEqual([])
    vi.advanceTimersByTime(1000)
    expect(removed).toEqual(['title'])
    expect(saved).toEqual([])
    expect(openLayerGraph(swf, '2:4', 'Title')).toBe('title') // the layer keeps the same canvas
    undoSwf('swf')
    expect(store.getState().nodes).toHaveLength(1)
    expect(scripts('2:4')).toEqual(['title'])
    expect(useGraphDocs.getState().ids['swf']).toEqual(['title'])
    vi.advanceTimersByTime(1000)
    expect(saved).toEqual(['title'])
  })

  it('delete removes the file, the store, its history entries and every scripts reference; a late save cannot bring it back', async () => {
    const withNode = (id: string, scope: Graph['scope']): Graph => ({ ...emptyGraph(id, id, scope), nodes: [{ id: 'n', kind: 'core/OnLoad@1', fields: {}, pos: { x: 0, y: 0 } }] })
    const api = fakeApi([withNode('hud', 'menu'), withNode('title', 'component')])
    const saved: string[] = []
    setGraphSaver((_n, g) => void saved.push(g.id))
    await loadSwfGraphs(swf, api)
    editNode('swf', '2:4', { scripts: ['title'] })
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
    const api = fakeApi([{ ...emptyGraph('main', 'Main', 'menu'), nodes: [{ id: 'n', kind: 'core/OnLoad@1', fields: {}, pos: { x: 0, y: 0 } }] }]) // a blank layer graph is never saved
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
