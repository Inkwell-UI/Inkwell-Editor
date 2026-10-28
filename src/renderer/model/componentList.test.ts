import { describe, expect, it } from 'vitest'
import { componentRows } from './componentList'

const node = (id: string, type: string, parent: string | null, extra: object = {}) => [id, { id, name: id.toUpperCase(), type, parent, children: [], ...extra }] as const
const swf = (name: string, nodes: (readonly [string, object])[]) => ({ name, root: 'f', nodes: Object.fromEntries(nodes) }) as never

describe('componentRows', () => {
  it('lists page components and the ones inside a SWF, the variants of a set only once, with how often each is used', () => {
    const s = swf('menu', [node('f', 'frame', null, { children: ['set', 'i1', 'i2'] }), node('set', 'component', 'f', { children: ['v1'] }), node('v1', 'component', 'set'), node('i1', 'instance', 'f', { component: 'page1' }), node('i2', 'instance', 'f', { component: 'page1' })])
    expect(componentRows([s], [{ id: 'page1', name: 'ListItem' }])).toEqual([
      { id: 'page1', name: 'ListItem', instances: 2 },
      { id: 'set', name: 'SET', swfName: 'menu', instances: 0 }
    ])
  })
  it('nothing: no rows', () => expect(componentRows([])).toEqual([]))
  it('a component that left the design (still in the saved IR, no longer reached) or is also on the page is not listed twice', () => {
    const s = swf('menu', [node('f', 'frame', null), node('gone', 'component', null), node('page1', 'component', 'f')])
    expect(componentRows([s], [{ id: 'page1', name: 'ListItem' }]).map((r) => r.id)).toEqual(['page1'])
  })
})
