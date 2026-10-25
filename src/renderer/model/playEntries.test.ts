import { describe, expect, it } from 'vitest'
import type { Graph } from '@inkwell-ui/spec'
import { callArgs, playEntries } from './playEntries'

const n = (id: string, kind: string, fields: Record<string, unknown>) => ({ id, kind, fields, pos: { x: 0, y: 0 } })
const g = (id: string, nodes: ReturnType<typeof n>[]) => ({ id, name: id.toUpperCase(), nodes }) as unknown as Graph

describe('playEntries', () => {
  it('lists On Widget Call nodes with typed params and skips entries codegen would refuse', () => {
    const list = playEntries([
      g('main', [
        n('a', 'core/OnWidgetCall@1', { name: 'Show', params: [{ name: 'title', type: 'String' }, { name: 'hold', type: 'Number' }] }),
        n('b', 'core/Log@1', {}),
        n('c', 'core/OnWidgetCall@1', { name: 'bad name', params: [] }),
        n('d', 'core/OnWidgetCall@1', { name: 'Hide', params: [{ name: 'x', type: 'Array' }] })
      ]),
      g('second', [n('e', 'core/OnWidgetCall@1', { name: 'Ping' })])
    ])
    expect(list.map((e) => [e.key, e.name, e.params.length])).toEqual([['main/a', 'Show', 2], ['second/e', 'Ping', 0]])
  })
  it('sends all arguments as strings like Papyrus, with the pin defaults for missing values', () => {
    const params = [{ name: 't', type: 'String' }, { name: 'h', type: 'Number' }, { name: 's', type: 'Bool' }] as const
    expect(callArgs(params, { t: 'Hi', h: '2.5', s: true })).toEqual(['Hi', '2.5', 'true'])
    expect(callArgs(params, { h: 'abc' })).toEqual(['', '0', 'false'])
  })
})
