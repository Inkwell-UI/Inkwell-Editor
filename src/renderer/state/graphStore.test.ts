import { resolve } from 'node:path'
import type { Graph } from '@inkwell-ui/spec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPacks } from '../../main/packs'
import { defIndex, emptyGraph } from '../../shared/graphs'
import { flushGraphSaves, getGraphStore, resetGraphs, setGraphSaver, toGraph, visibleVariables } from './graphStore'
import { createGraphValidation } from './graphValidation'
import { editNode, getOverlayStore, redoSwf, resetOverlays, setOverlaySaver, undoSwf } from './overlayStore'
import { useSwfHistory } from './swfHistory'

let now = 1000
beforeEach(() => {
  vi.useFakeTimers()
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  resetGraphs()
  resetOverlays()
  setOverlaySaver(undefined)
  setGraphSaver(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const tick = (ms = 100) => void (now += ms)

const base = (): Graph =>
  ({
    ...emptyGraph('menu', 'Menu', 'menu'),
    futureTop: { k: 1 },
    nodes: [{ id: 'a', kind: 'core/Log@1', fields: { message: '' }, pos: { x: 1, y: 2, z: 9 }, hint: 'x' }],
    edges: [],
    variables: [{ id: 'v', name: 'count', type: 'Number', scope: 'menu' }]
  }) as Graph
const past = (s: ReturnType<typeof getGraphStore>) => s.temporal.getState().pastStates.length

describe('graph store', () => {
  it('round-trips the file shape with unknown keys, and edits become the saved graph', () => {
    const s = getGraphStore('swf', 'Hud', base())
    expect(toGraph(s.getState())).toEqual(base())
    s.getState().addNode({ id: 'b', kind: 'core/Log@1', pos: { x: 5, y: 6 } })
    s.getState().connect({ node: 'a', pin: 'then' }, { node: 'b', pin: 'in' })
    const g = toGraph(s.getState())
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(g.edges).toEqual([{ from: { node: 'a', pin: 'then' }, to: { node: 'b', pin: 'in' } }])
    expect(g['futureTop']).toEqual({ k: 1 })
    expect(g.nodes[0]).toMatchObject({ hint: 'x', pos: { x: 1, y: 2, z: 9 } })
  })

  it('typing coalesces per word; selection is not recorded; a drag is one entry', () => {
    const s = getGraphStore('swf', 'Hud', base())
    const type = (v: string) => (tick(40), s.getState().setField('a', 'message', v))
    type('h')
    type('he')
    type('hel')
    expect(past(s)).toBe(1)
    type('hel ')
    type('hel w') // a space ends the word
    expect(past(s)).toBe(2)
    tick()
    s.getState().setSelection(['a'])
    expect(past(s)).toBe(2)
    tick()
    s.getState().beginDrag()
    s.getState().moveNodes({ a: { x: 10, y: 10 } })
    s.getState().moveNodes({ a: { x: 20, y: 30 } })
    s.getState().endDrag()
    expect(past(s)).toBe(3)
    s.temporal.getState().undo()
    expect(s.getState().nodes[0]!.position).toEqual({ x: 1, y: 2 })
  })

  it('removing a node removes its wires and group membership in one step', () => {
    const g = base()
    g.nodes.push({ id: 'b', kind: 'core/Log@1', fields: {}, pos: { x: 0, y: 0 } })
    g.edges.push({ from: { node: 'a', pin: 'then' }, to: { node: 'b', pin: 'in' } })
    g.groups.push({ id: 'g', name: 'G', nodes: ['a', 'b'], pos: { x: 0, y: 0 } })
    const s = getGraphStore('swf', 'Hud', g)
    s.getState().removeNodes(['b'])
    expect(toGraph(s.getState())).toMatchObject({ edges: [], groups: [{ nodes: ['a'] }] })
    expect(past(s)).toBe(1)
    s.temporal.getState().undo()
    expect(s.getState().edges).toHaveLength(1)
  })

  it('saves debounced and only for real changes', () => {
    const saved: Graph[] = []
    setGraphSaver((_n, g) => void saved.push(g))
    const s = getGraphStore('swf', 'Hud', base())
    s.getState().setSelection(['a'])
    vi.advanceTimersByTime(1000)
    expect(saved).toHaveLength(0)
    s.getState().moveNodes({ a: { x: 3, y: 3 } })
    s.getState().moveNodes({ a: { x: 4, y: 4 } })
    vi.advanceTimersByTime(1000)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.nodes[0]!.pos).toMatchObject({ x: 4, y: 4, z: 9 })
    s.getState().moveNodes({ a: { x: 5, y: 5 } })
    flushGraphSaves()
    expect(saved).toHaveLength(2)
  })

  it('variables: scope follows the graph; a component graph sees the menu variables plus its own', () => {
    const menu = getGraphStore('swf', 'Hud', base())
    const comp = getGraphStore('swf', 'Hud', emptyGraph('c1', 'Button', 'component'))
    comp.getState().addVariable({ id: 'cv', name: 'pressed', type: 'Bool' })
    expect(comp.getState().variables[0]).toMatchObject({ scope: 'component' })
    const seen = visibleVariables(toGraph(comp.getState()), toGraph(menu.getState())).map((v) => v.id)
    expect(seen).toEqual(['v', 'cv'])
    expect(visibleVariables(toGraph(menu.getState()), undefined).map((v) => v.id)).toEqual(['v'])
    comp.getState().removeVariable('cv')
    expect(comp.getState().variables).toEqual([])
  })
})

describe('one history per SWF across graphs and overlay', () => {
  it('undo and redo follow the order of edits, whichever store they were made in', () => {
    getOverlayStore('swf', 'Hud', { specVersion: 5, nodes: {} })
    const menu = getGraphStore('swf', 'Hud', base())
    const comp = getGraphStore('swf', 'Hud', emptyGraph('c1', 'Button', 'component'))
    const other = getGraphStore('other', 'Other', base())
    tick()
    editNode('swf', '1:2', { role: 'button' })
    tick()
    menu.getState().moveNodes({ a: { x: 9, y: 9 } })
    tick()
    comp.getState().addVariable({ id: 'cv', name: 'p', type: 'Bool' })
    tick()
    other.getState().moveNodes({ a: { x: 7, y: 7 } })
    expect(useSwfHistory.getState().counts['swf']).toEqual({ undo: 3, redo: 0 })
    undoSwf('swf')
    expect(comp.getState().variables).toEqual([])
    expect(menu.getState().nodes[0]!.position).toEqual({ x: 9, y: 9 })
    undoSwf('swf')
    expect(menu.getState().nodes[0]!.position).toEqual({ x: 1, y: 2 })
    expect(other.getState().nodes[0]!.position).toEqual({ x: 7, y: 7 }) // another SWF has its own history
    redoSwf('swf')
    expect(menu.getState().nodes[0]!.position).toEqual({ x: 9, y: 9 })
    tick()
    editNode('swf', '1:2', { role: 'list' }) // a new edit clears Redo
    expect(useSwfHistory.getState().counts['swf']).toEqual({ undo: 3, redo: 0 })
    undoSwf('swf')
    undoSwf('swf')
    undoSwf('swf')
    expect(getOverlayStore('swf', 'Hud', { specVersion: 5 }).getState().doc.nodes).toEqual({})
    expect(useSwfHistory.getState().counts['swf']).toEqual({ undo: 0, redo: 3 })
  })
})

describe('live validation (Knotwork createValidation)', () => {
  it('computes issues pinned to node ids and reruns after an edit', async () => {
    const defs = defIndex(await loadPacks([resolve(__dirname, '../../../tests/fixtures/packs/test-pack')]))
    const g = base()
    g.nodes.push({ id: 's', kind: 'core/SetText@1', fields: {}, pos: { x: 0, y: 0 } })
    const store = getGraphStore('swf', 'Hud', g)
    const v = createGraphValidation(store, () => ({ defs }))
    const stop = v.start()
    expect(v.use.getState().byNode['s']).toMatch(/^error\|/)
    store.getState().setField('s', 'target', 'L1')
    vi.advanceTimersByTime(200)
    expect(v.use.getState().byNode['s']).toMatch(/^warning\|/) // the error is gone; only the dangling-exec warning is left
    stop()
  })
})
