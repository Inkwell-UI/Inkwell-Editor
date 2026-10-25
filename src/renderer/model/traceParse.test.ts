import { describe, expect, it } from 'vitest'
import { clockTime, parseTrace } from './traceParse'

describe('parseTrace', () => {
  it('reads a Log node line and a handler failure', () => {
    expect(parseTrace('[Inkwell] info log: shown')).toEqual({ kind: 'log', level: 'info', node: 'log', message: 'shown' })
    expect(parseTrace('[Inkwell] error node-1: boom: with colon')).toEqual({ kind: 'log', level: 'error', node: 'node-1', message: 'boom: with colon' })
    expect(parseTrace('[Inkwell] error binding:score: bad')).toEqual({ kind: 'log', level: 'error', node: 'binding:score', message: 'bad' })
  })
  it('reads pin values, with dots in the node id and quoted strings', () => {
    expect(parseTrace('[Inkwell] pin notempty.value = true')).toEqual({ kind: 'pin', node: 'notempty', pin: 'value', value: 'true' })
    expect(parseTrace('[Inkwell] pin a.b.out = "x = y"')).toEqual({ kind: 'pin', node: 'a.b', pin: 'out', value: '"x = y"' })
  })
  it('finds the marker behind a console prefix; other trace lines are plain text', () => {
    expect(parseTrace('avm_trace: [Inkwell] warn n: careful')).toMatchObject({ kind: 'log', level: 'warn', node: 'n' })
    expect(parseTrace('[Inkwell] preview bridge unavailable')).toEqual({ kind: 'text', message: 'preview bridge unavailable' })
    expect(parseTrace('hello from the movie')).toEqual({ kind: 'text', message: 'hello from the movie' })
    expect(parseTrace('  ')).toBeNull()
  })
  it('formats the clock', () => {
    expect(clockTime(new Date(2026, 0, 1, 9, 5, 3, 7).getTime())).toBe('09:05:03.007')
  })
})
