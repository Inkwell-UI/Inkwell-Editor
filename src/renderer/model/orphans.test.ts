import type { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { computeOrphans } from './orphans'

const swf = (id: string, nodeIds: string[], overlay: Record<string, Record<string, unknown>>, orphaned = false) => ({
  id, name: id, orphaned,
  ir: { nodes: Object.fromEntries(nodeIds.map((n) => [n, {}])) } as unknown as Swf,
  overlay: { specVersion: 3, nodes: overlay }
})

describe('computeOrphans', () => {
  it('lists overlay entries whose node is gone, with what they hold (unknown keys included)', () => {
    const r = computeOrphans([swf('a', ['1'], { '1': { role: 'text' }, '2': { scripts: ['g'], instanceName: 'x', future: 1 }, '3': {} })])
    expect(r).toEqual([{ kind: 'overlay', swfId: 'a', swfName: 'a', nodeId: '2', held: ['future', 'instanceName', 'scripts'] }])
  })
  it('lists orphaned swfs as one entry and does not itemize their overlay', () => {
    const r = computeOrphans([swf('a', [], { '9': { role: 'x' } }, true), swf('b', ['1'], { '1': { role: 'x' } })])
    expect(r).toEqual([{ kind: 'swf', swfId: 'a', swfName: 'a' }])
  })
  it('nothing when everything resolves', () => {
    expect(computeOrphans([swf('a', ['1'], { '1': { role: 'x' } })])).toEqual([])
    expect(computeOrphans([])).toEqual([])
  })
})
