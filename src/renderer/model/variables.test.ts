import { describe, expect, it } from 'vitest'
import type { Graph } from '@inkwell-ui/spec'
import { emptyGraph } from '../../shared/graphs'
import { graphForComponent, ownersOfGraph } from './graphNav'
import { bindableVariables, bindingTypeOk, defaultFor, droppedVariable, mockValue, newVariableId, variableDragData, variableTarget } from './variables'

const g = (id: string, scope: Graph['scope'], variables: Graph['variables'] = []): Graph => ({ ...emptyGraph(id, id, scope), variables })
const v = (id: string, scope: 'menu' | 'component', type: 'Bool' | 'Number' | 'String' = 'Number') => ({ id, name: id, type, scope }) as Graph['variables'][number]

describe('variables', () => {
  it('makes unique ids across all graphs of the SWF', () => {
    const graphs = [g('m', 'menu', [v('score', 'menu')]), g('c', 'component', [v('score-2', 'component')])]
    expect(newVariableId('Score', graphs)).toBe('score-3')
    expect(newVariableId('Lives', graphs)).toBe('lives')
  })
  it('a menu variable goes to the menu graph, a component variable to the open component graph', () => {
    expect(variableTarget('menu', { menuGraphId: 'm', activeId: 'c', activeScope: 'component' })).toEqual({ graphId: 'm' })
    expect(variableTarget('menu', { menuGraphId: undefined, activeId: undefined, activeScope: undefined })).toHaveProperty('reason')
    expect(variableTarget('component', { menuGraphId: 'm', activeId: 'c', activeScope: 'component' })).toEqual({ graphId: 'c' })
    expect(variableTarget('component', { menuGraphId: 'm', activeId: 'm', activeScope: 'menu' })).toHaveProperty('reason')
  })
  it('defaults follow the type', () => {
    expect([defaultFor('Bool'), defaultFor('Number'), defaultFor('String'), defaultFor('Array')]).toEqual([false, 0, '', []])
  })
  it('a layer can bind menu variables and those of its own graphs', () => {
    const graphs = [g('m', 'menu', [v('a', 'menu'), v('b', 'component')]), g('c1', 'component', [v('c', 'component')]), g('c2', 'component', [v('d', 'component')])]
    expect(bindableVariables(graphs, ['c1']).map((x) => x.id)).toEqual(['a', 'c'])
    expect(bindableVariables(graphs, []).map((x) => x.id)).toEqual(['a'])
  })
  it('flags a bound type that differs from what the property wants', () => {
    expect(bindingTypeOk('visible', 'Bool')).toBe(true)
    expect(bindingTypeOk('visible', 'String')).toBe(false)
    expect(bindingTypeOk('text', 'Number')).toBe(true)
    expect(bindingTypeOk('alpha', 'Bool')).toBe(false)
  })
  it('mock values keep their type', () => {
    expect([mockValue('Number', '4.5'), mockValue('Number', 'x'), mockValue('Bool', 'true'), mockValue('String', '7')]).toEqual([4.5, 0, true, '7'])
  })
})

describe('selecting a component selects its graph', () => {
  const overlay = { specVersion: 5, nodes: { a: { scripts: ['g1', 'gone'] }, b: { scripts: ['g2'] }, c: {} } }
  const existing = ['g1', 'g2', 'g3']
  it('opens the first existing graph of the component, keeps the open one when it is already its graph, ignores components without graphs', () => {
    expect(graphForComponent(overlay, 'a', existing, 'g3')).toBe('g1')
    expect(graphForComponent(overlay, 'a', existing, 'g1')).toBeUndefined()
    expect(graphForComponent(overlay, 'c', existing, 'g3')).toBeUndefined()
    expect(graphForComponent(overlay, 'zzz', existing, undefined)).toBeUndefined()
    expect(graphForComponent(overlay, 'b', ['g1'], 'g1')).toBeUndefined() // g2 does not exist (yet)
  })
  it('finds the layers a graph is attached to', () => {
    expect(ownersOfGraph(overlay, 'g1')).toEqual(['a'])
    expect(ownersOfGraph(overlay, 'nope')).toEqual([])
  })
})

describe('droppedVariable', () => {
  const visible = [v('hp', 'menu'), v('tmp', 'component')]
  it('accepts a visible variable of the same SWF', () => {
    expect(droppedVariable(variableDragData('swf', 'hp'), 'swf', visible)?.id).toBe('hp')
  })
  it('ignores another SWF, an invisible variable and junk', () => {
    expect(droppedVariable(variableDragData('other', 'hp'), 'swf', visible)).toBeUndefined()
    expect(droppedVariable(variableDragData('swf', 'gone'), 'swf', visible)).toBeUndefined()
    expect(droppedVariable('not json', 'swf', visible)).toBeUndefined()
  })
})
