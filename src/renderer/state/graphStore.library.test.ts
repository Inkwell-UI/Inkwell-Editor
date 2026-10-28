// Library functions in the graph store: the Call Function picker, refreshing calls when the pack set changes, and a library function open for editing.
import type { Graph } from '@inkwell-ui/spec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callFields, newFunctionGraph } from '../../shared/functions'
import { graph, node, wire } from '../../main/codegen/codegen.testutil'
import { functionChoices, functionGraphs, getGraphStore, resetGraphs, setGraphSaver, setLibraryFunctions, toGraph } from './graphStore'

let n = 0
const ids = () => `l${++n}`
const lib = (): Graph => ({ ...newFunctionGraph('greet', 'Greet', ids), id: 'my-lib/greet' }) as Graph
const withInput = (g: Graph): Graph => ({ ...g, signature: { ...g.signature!, inputs: [{ id: 'i1', name: 'who', type: 'String' }] } }) as Graph

beforeEach(() => {
  vi.useFakeTimers()
  resetGraphs()
  setLibraryFunctions(new Map())
  setGraphSaver(undefined)
})
afterEach(() => vi.useRealTimers())

function menuWithCall(fn: Graph) {
  const g = graph('main', [node('ol', 'core/OnLoad@1'), node('c', 'core/CallFunction@1', callFields(fn)), node('l', 'core/Log@1', { level: 'info' })], [wire('ol', 'then', 'c', 'in'), wire('c', 'Done', 'l', 'in')])
  return getGraphStore('swf', 'Hud', g)
}

describe('library functions in the store', () => {
  it('the picker offers library functions after the SWF\'s own, with the pack in the label', () => {
    const own = getGraphStore('swf', 'Hud', newFunctionGraph('mine', 'Mine', ids))
    const main = getGraphStore('swf', 'Hud', graph('main', [], []))
    setLibraryFunctions(new Map([['my-lib/greet', lib()]]))
    expect(functionGraphs(main).map((g) => g.id)).toEqual(['mine', 'my-lib/greet'])
    expect(functionChoices(main)).toEqual([{ id: 'mine', name: 'Mine' }, { id: 'my-lib/greet', name: 'Greet (my-lib)' }])
    expect(own.getState().meta.scope).toBe('function')
  })

  it('a library function open for editing is not one of the SWF\'s own functions', () => {
    const main = getGraphStore('swf', 'Hud', graph('main', [], []))
    getGraphStore('swf', '@lib:my-lib', lib())
    expect(functionGraphs(main).map((g) => g.id)).toEqual([])
  })

  it('a changed library signature (a pack update) refreshes the calls to it without recording them', () => {
    const v1 = lib()
    setLibraryFunctions(new Map([['my-lib/greet', v1]]))
    const main = menuWithCall(v1)
    const past = main.temporal.getState().pastStates.length
    setLibraryFunctions(new Map([['my-lib/greet', withInput(v1)]]))
    const call = toGraph(main.getState()).nodes.find((x) => x.id === 'c')!
    expect(call.fields['inputs']).toEqual([expect.objectContaining({ name: 'who' })])
    expect(toGraph(main.getState()).edges.some((e) => e.from.node === 'c' && e.to.node === 'l')).toBe(true) // the Done wire survives (same exit id)
    expect(main.temporal.getState().pastStates.length).toBe(past)
  })

  it('a call to a function that is not installed is left alone', () => {
    const main = menuWithCall(lib())
    const before = JSON.stringify(toGraph(main.getState()))
    setLibraryFunctions(new Map())
    expect(JSON.stringify(toGraph(main.getState()))).toBe(before)
  })

  it('editing a library function saves under its store name, so the bridge can route it into the pack folder', () => {
    const saved: [string, Graph][] = []
    setGraphSaver((name, g) => void saved.push([name, g]))
    const store = getGraphStore('swf', '@lib:my-lib', lib())
    store.getState().rename('Greeter')
    vi.runAllTimers()
    expect(saved).toEqual([['@lib:my-lib', expect.objectContaining({ id: 'my-lib/greet', name: 'Greeter' })]])
  })
})
