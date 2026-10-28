import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newComponentGraph } from '../../shared/graphs'
import { getGraphStore, resetGraphs, setGraphSaver, toGraph } from './graphStore'
import { propNameProblem } from '../graph/PropsEditor'

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
})
