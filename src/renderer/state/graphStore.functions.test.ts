// Functions in the graph store: the signature is part of the document (saved, undoable), and a signature change refreshes the calls in the SWF's other graphs.
import type { Graph } from '@inkwell-ui/spec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractFunction, newFunctionGraph } from '../../shared/functions'
import { graph, loadCore, node, wire } from '../../main/codegen/codegen.testutil'
import { flushGraphSaves, functionGraphs, getGraphStore, pointCall, resetGraphs, setGraphSaver, toGraph } from './graphStore'
import { resetOverlays, setOverlaySaver, undoSwf, redoSwf } from './overlayStore'

const packs = await loadCore()
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

/** A menu graph whose Delay + Log became a function, both loaded into stores of one SWF. */
function setup() {
  const g = graph('main', [node('ol', 'core/OnLoad@1'), node('d', 'core/Delay@1'), node('l', 'core/Log@1', { level: 'info' }), node('after', 'core/Log@1', { level: 'info', message: 'after' }), node('ts', 'core/ToString@1')],
    [wire('ol', 'then', 'd', 'in'), wire('d', 'then', 'l', 'in'), wire('l', 'then', 'after', 'in'), wire('ts', 'value', 'l', 'message')])
  let n = 0
  const r = extractFunction(g, new Set(['d', 'l']), packs.defs, { id: 'wl', name: 'WL', callId: 'call', newId: () => `i${++n}` })
  if (!r.ok) throw new Error(r.error)
  const fn = getGraphStore('swf', 'Hud', r.fn)
  const main = getGraphStore('swf', 'Hud', r.caller)
  return { fn, main }
}
const edgeTo = (g: Graph, node: string, pin: string) => g.edges.find((e) => e.to.node === node && e.to.pin === pin)

describe('signature in the store', () => {
  it('is saved with the graph and survives toGraph', () => {
    const { fn } = setup()
    expect(toGraph(fn.getState()).signature?.inputs.map((p) => p.name)).toEqual(['message'])
    expect(fn.getState().meta).not.toHaveProperty('signature')
  })

  it('a rename keeps the wires of the function and updates the calls of other graphs without recording them', () => {
    const { fn, main } = setup()
    const sig = fn.getState().signature!
    const callerPast = main.temporal.getState().pastStates.length
    fn.getState().setSignature({ ...sig, inputs: sig.inputs.map((p) => ({ ...p, name: 'text' })) })
    const f = toGraph(fn.getState())
    const feId = f.nodes.find((n) => n.kind.includes('FunctionEntry'))!.id
    expect(f.edges).toContainEqual(expect.objectContaining({ from: { node: feId, pin: 'text' }, to: { node: 'l', pin: 'message' } }))
    const m = toGraph(main.getState())
    expect(edgeTo(m, 'call', 'text')?.from).toEqual({ node: 'ts', pin: 'value' })
    expect(m.nodes.find((n) => n.id === 'call')!.fields['inputs']).toEqual([expect.objectContaining({ name: 'text' })])
    expect(main.temporal.getState().pastStates.length).toBe(callerPast)
  })

  it('undo of the signature change brings the function and its calls back, redo repeats it', () => {
    const { fn, main } = setup()
    const sig = fn.getState().signature!
    now += 1000
    fn.getState().setSignature({ ...sig, inputs: sig.inputs.map((p) => ({ ...p, name: 'text' })) })
    expect(edgeTo(toGraph(main.getState()), 'call', 'text')).toBeDefined()
    undoSwf('swf')
    expect(fn.getState().signature?.inputs[0]?.name).toBe('message')
    expect(edgeTo(toGraph(main.getState()), 'call', 'message')).toBeDefined()
    expect(edgeTo(toGraph(main.getState()), 'call', 'text')).toBeUndefined()
    redoSwf('swf')
    expect(edgeTo(toGraph(main.getState()), 'call', 'text')).toBeDefined()
  })

  it('removing an exit drops the wire that left it; the saver gets the new signature', () => {
    const saved: Graph[] = []
    setGraphSaver((_swf, g) => void saved.push(g))
    const { fn, main } = setup()
    const sig = fn.getState().signature!
    fn.getState().setSignature({ ...sig, exits: [{ id: 'fresh', name: 'finished' }] })
    flushGraphSaves()
    vi.runAllTimers()
    expect(toGraph(main.getState()).edges.some((e) => e.from.node === 'call' && e.to.node === 'after')).toBe(false)
    expect(saved.some((g) => g.id === 'wl' && g.signature?.exits[0]?.name === 'finished')).toBe(true)
  })
})

describe('Call Function target', () => {
  it('lists the function graphs of the SWF and points a call at another function', () => {
    const { fn, main } = setup()
    const other = getGraphStore('swf', 'Hud', newFunctionGraph('other', 'Other', (() => { let k = 0; return () => `o${++k}` })()))
    expect(functionGraphs(main).map((g) => g.id).sort()).toEqual(['other', 'wl'])
    pointCall(main, 'call', 'other')
    const call = toGraph(main.getState()).nodes.find((n) => n.id === 'call')!
    expect(call.fields['function']).toBe('other')
    expect(call.fields['exits']).toEqual([expect.objectContaining({ name: 'Done' })])
    expect(toGraph(main.getState()).edges.some((e) => e.from.node === 'call' && e.to.node === 'after')).toBe(false) // the old exit's wire is gone
    expect(edgeTo(toGraph(main.getState()), 'call', 'in')).toBeDefined() // the exec input stays wired
    expect(fn.getState().signature?.exits[0]?.name).toBe('then')
    expect(other.getState().meta.scope).toBe('function')
  })
})
