import { describe, expect, it } from 'vitest'
import { highlightAs2, linesOfNode, nodeOfLine, sourceLines } from './as2View'

describe('highlightAs2', () => {
  it('classifies tokens, keeps the text, and carries block comments across lines', () => {
    const src = ['var x = "a//b" + 0x1F; // note', '/* open', 'still */ return x;']
    const out = highlightAs2(src)
    expect(out.map((l) => l.map((t) => t.text).join(''))).toEqual(src)
    expect(out[0]!.filter((t) => t.kind !== 'plain').map((t) => [t.text, t.kind])).toEqual([
      ['var', 'keyword'], ['"a//b"', 'string'], ['0x1F', 'number'], ['// note', 'comment']
    ])
    expect(out[1]).toEqual([{ text: '/* open', kind: 'comment' }])
    expect(out[2]![0]).toEqual({ text: 'still */', kind: 'comment' })
    expect(out[2]!.some((t) => t.text === 'return' && t.kind === 'keyword')).toBe(true)
  })
})

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
