// [+ Function] and Make function against a fake of the graph IPC calls over an in-memory disk.
import type { Graph } from '@inkwell-ui/spec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { graph, loadCore, node, wire } from '../../main/codegen/codegen.testutil'
import { newFunctionGraph } from '../../shared/functions'
import { emptyGraph, newGraphId, summarize } from '../../shared/graphs'
import { validateGraph } from '../../shared/graphValidate'
import { addFunction, loadSwfGraphs, makeFunction, moveFunctionToPack, resetGraphDocs, useGraphDocs } from './graphDocs'
import { findGraphStore, flushGraphSaves, setGraphSaver, toGraph } from './graphStore'
import { getOverlayStore, resetOverlays, setOverlaySaver, undoSwf } from './overlayStore'

const packs = await loadCore()

function fakeApi(initial: Graph[] = []) {
  const disk = new Map(initial.map((g) => [g.id, g]))
  return {
    disk,
    listGraphs: vi.fn(async () => ({ ok: true as const, graphs: [...disk.values()].map(summarize) })),
    loadGraph: vi.fn(async (_s: string, id: string) => ({ ok: true as const, graph: disk.get(id)! })),
    createGraph: vi.fn(async (_s: string, name: string, scope: Graph['scope']) => {
      const id = newGraphId(name, new Set(disk.keys()))
      const g = scope === 'function' ? newFunctionGraph(id, name) : emptyGraph(id, name, scope)
      disk.set(g.id, g)
      return { ok: true as const, graph: g }
    }),
    deleteGraph: vi.fn(async () => ({ ok: true as const }))
  }
}
const swf = { id: 'swf', name: 'Hud', root: 'root' }

beforeEach(() => {
  vi.useFakeTimers()
  resetGraphDocs()
  resetOverlays()
  setOverlaySaver(undefined)
  setGraphSaver(undefined)
  getOverlayStore('swf', 'Hud', { specVersion: 5, nodes: {} })
})
afterEach(() => vi.useRealTimers())

describe('[+ Function]', () => {
  it('creates a function graph, opens it and does not attach it to a layer', async () => {
    const api = fakeApi()
    await loadSwfGraphs(swf, api)
    const r = await addFunction({ swf, name: 'Fade In' }, api)
    expect(r).toEqual({ ok: true, id: 'fade-in' })
    expect(api.createGraph).toHaveBeenCalledWith('Hud', 'Fade In', 'function')
    expect(useGraphDocs.getState().active['swf']).toBe('fade-in')
    expect(findGraphStore('swf', 'fade-in')?.getState().signature?.exits).toHaveLength(1)
  })
})

describe('Make function', () => {
  const menu = (): Graph =>
    ({ ...graph('main', [node('ol', 'core/OnLoad@1'), node('d', 'core/Delay@1'), node('l', 'core/Log@1', { level: 'info' }), node('after', 'core/Log@1', { level: 'info', message: 'after' })],
      [wire('ol', 'then', 'd', 'in'), wire('d', 'then', 'l', 'in'), wire('l', 'then', 'after', 'in')]), scope: 'menu' }) as Graph

  it('creates and saves the function, replaces the selection with a call, and undo restores the nodes', async () => {
    const saved: Graph[] = []
    setGraphSaver((_s, g) => void saved.push(g))
    const api = fakeApi([menu()])
    await loadSwfGraphs(swf, api)
    const store = findGraphStore('swf', 'main')!
    const r = await makeFunction({ swf, store, selected: ['d', 'l'], name: 'Wait Log', defs: packs.defs }, api)
    expect(r).toEqual({ ok: true, id: 'wait-log' })
    // the function file got its real content, not the empty default
    expect(saved.find((g) => g.id === 'wait-log')?.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['d', 'l']))
    const caller = toGraph(store.getState())
    expect(caller.nodes.map((n) => n.kind).sort()).toEqual(['core/CallFunction@1', 'core/Log@1', 'core/OnLoad@1'])
    expect(caller.nodes.find((n) => n.kind === 'core/CallFunction@1')!.fields['function']).toBe('wait-log')
    expect(useGraphDocs.getState().ids['swf']).toEqual(['main', 'wait-log'])
    expect(useGraphDocs.getState().active['swf']).toBe('main') // the open graph stays open
    // both graphs validate against each other
    const fn = toGraph(findGraphStore('swf', 'wait-log')!.getState())
    const errors = (g: Graph, s: Graph[]) => validateGraph(g, { defs: packs.defs, siblings: s }).filter((i) => i.level === 'error')
    expect(errors(fn, [caller])).toEqual([])
    expect(errors(caller, [fn])).toEqual([])
    undoSwf('swf')
    expect(toGraph(store.getState()).nodes.map((n) => n.id).sort()).toEqual(['after', 'd', 'l', 'ol'])
    flushGraphSaves()
  })

  it('a refused selection creates nothing', async () => {
    const api = fakeApi([menu()])
    await loadSwfGraphs(swf, api)
    const store = findGraphStore('swf', 'main')!
    const r = await makeFunction({ swf, store, selected: ['ol', 'd'], name: 'Bad', defs: packs.defs }, api)
    expect(r.ok).toBe(false)
    expect(api.createGraph).not.toHaveBeenCalled()
    expect(useGraphDocs.getState().ids['swf']).toEqual(['main'])
  })
})

describe('drag a function onto a pack', () => {
  it('writes it to the pack, calls say <pack>/<id>, and the SWF copy is gone', async () => {
    const fn = newFunctionGraph('fade', 'Fade', () => 'f1')
    const main = graph('main', [node('ol', 'core/OnLoad@1'), node('c', 'core/CallFunction@1', { function: 'fade', inputs: fn.signature!.inputs, outputs: fn.signature!.outputs, exits: fn.signature!.exits })], [wire('ol', 'then', 'c', 'in')])
    const api = { ...fakeApi([main, fn]), addFunctionToLibrary: vi.fn(async (_p: string, g: Graph) => ({ ok: true as const, id: g.id })) }
    await loadSwfGraphs(swf, api)
    const r = await moveFunctionToPack({ swf, fnId: 'fade', packId: 'my-pack' }, api)
    expect(r).toEqual({ ok: true, id: 'my-pack/fade' })
    expect(api.addFunctionToLibrary).toHaveBeenCalledWith('my-pack', expect.objectContaining({ id: 'fade', scope: 'function' }))
    expect(api.deleteGraph).toHaveBeenCalledWith('Hud', 'fade')
    expect(useGraphDocs.getState().ids['swf']).toEqual(['main'])
    expect(toGraph(findGraphStore('swf', 'main')!.getState()).nodes.find((x) => x.id === 'c')!.fields['function']).toBe('my-pack/fade')
  })

  it('changes nothing when the pack refuses', async () => {
    const fn = newFunctionGraph('fade', 'Fade', () => 'f1')
    const api = { ...fakeApi([fn]), addFunctionToLibrary: vi.fn(async () => ({ ok: false as const, error: 'nope' })) }
    await loadSwfGraphs(swf, api)
    expect(await moveFunctionToPack({ swf, fnId: 'fade', packId: 'my-pack' }, api)).toEqual({ ok: false, error: 'nope' })
    expect(api.deleteGraph).not.toHaveBeenCalled()
    expect(useGraphDocs.getState().ids['swf']).toEqual(['fade'])
  })
})
