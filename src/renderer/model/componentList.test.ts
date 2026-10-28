import { describe, expect, it } from 'vitest'
import { componentRows } from './componentList'

const node = (id: string, type: string, parent: string | null, extra: object = {}) => [id, { id, name: id.toUpperCase(), type, parent, children: [], ...extra }] as const
const swf = (name: string, nodes: (readonly [string, object])[]) => ({ name, nodes: Object.fromEntries(nodes) }) as never

describe('componentRows', () => {
  it('lists page components and the ones inside a SWF, the variants of a set only once, with how often each is used', () => {
    const s = swf('menu', [node('f', 'frame', null), node('set', 'component', 'f'), node('v1', 'component', 'set'), node('i1', 'instance', 'f', { component: 'page1' }), node('i2', 'instance', 'f', { component: 'page1' })])
    expect(componentRows([s], [{ id: 'page1', name: 'ListItem' }])).toEqual([
      { id: 'page1', name: 'ListItem', instances: 2 },
      { id: 'set', name: 'SET', swfName: 'menu', instances: 0 }
    ])
  })
  it('nothing: no rows', () => expect(componentRows([])).toEqual([]))
})
