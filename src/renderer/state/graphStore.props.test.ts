import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { graph, loadCore, node } from '../../main/codegen/codegen.testutil'
import { newComponentGraph } from '../../shared/graphs'
import { validateGraph } from '../../shared/graphValidate'
import { nodePins } from '../model/graphModel'
import { getGraphStore, resetGraphs, setGraphSaver, toGraph } from './graphStore'
import { propNameProblem } from '../graph/PropsEditor'

const packs = await loadCore()
beforeEach(() => {
  vi.useFakeTimers()
  resetGraphs()
  setGraphSaver(undefined)
})
afterEach(() => vi.useRealTimers())

describe('component graph props', () => {
  it('setProps changes the graph, is saved with it, keeps the component id, and undoes', () => {
    const store = getGraphStore('swf', '@comp:36:5', newComponentGraph('36:5', 'ListItem'))
    store.getState().setProps([{ id: 'p', name: 'label', type: 'String', default: 'x' }])
    expect(toGraph(store.getState())).toMatchObject({ scope: 'blueprint', component: '36:5', props: [{ name: 'label', default: 'x' }] })
    store.temporal.getState().undo()
    expect(toGraph(store.getState()).props).toEqual([])
  })

  it('a prop name is an identifier and unique', () => {
    const props = [{ id: 'a', name: 'label', type: 'String' as const }]
    expect(propNameProblem(props, -1, 'label')).toBeDefined()
    expect(propNameProblem(props, 0, 'label')).toBeUndefined()
    expect(propNameProblem(props, -1, '1x')).toBeDefined()
    expect(propNameProblem(props, -1, 'count')).toBeUndefined()
  })

  it('Get Prop reads a prop: its output has the prop type, follows a retype, and is refused outside a component graph or for a missing prop', () => {
    const store = getGraphStore('swf', '@comp:36:5', { ...newComponentGraph('36:5', 'ListItem'), props: [{ id: 'p', name: 'count', type: 'Number', default: 0 }], nodes: [{ id: 'g', kind: 'core/GetProp@1', fields: {}, pos: { x: 0, y: 0 } }] })
    const type = (): string | undefined => nodePins(packs.defs, store.getState().nodes[0]!, [], undefined)?.outputs[0]?.type
    expect(validateGraph(toGraph(store.getState()), { defs: packs.defs }).map((i) => i.code)).toEqual(['graph-prop']) // no prop picked yet
    store.getState().setNodeProp('g', 'p')
    expect(type()).toBe('Number')
    expect(validateGraph(toGraph(store.getState()), { defs: packs.defs })).toEqual([])
    store.getState().setProps([{ id: 'p', name: 'count', type: 'String', default: '' }])
    expect(type()).toBe('String')
    store.getState().setProps([])
    expect(validateGraph(toGraph(store.getState()), { defs: packs.defs }).map((i) => i.code)).toEqual(['graph-prop'])
    const menu = graph('m', [node('g', 'core/GetProp@1')], [])
    expect(validateGraph(menu, { defs: packs.defs }).map((i) => i.code)).toContain('graph-prop')
  })
})
