import { describe, expect, it } from 'vitest'
import { linesOfNode, nodeOfLine, sourceLines } from './as2View'

const map = { '12': 'a', '13': 'b', '14': 'a', '20': 'b' }
describe('as2View', () => {
  it('finds the lines of a node in order and the node of a line', () => {
    expect(linesOfNode(map, 'a')).toEqual([12, 14])
    expect(linesOfNode(map, 'zzz')).toEqual([])
    expect(linesOfNode(map, undefined)).toEqual([])
    expect(nodeOfLine(map, 13)).toBe('b')
    expect(nodeOfLine(map, 1)).toBeUndefined()
  })
  it('splits a source without a trailing empty line', () => {
    expect(sourceLines('a\nb\n')).toEqual(['a', 'b'])
  })
})
