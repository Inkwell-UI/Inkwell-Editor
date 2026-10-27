import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_TRACE_LINES, useTraceStore } from './traceStore'

beforeEach(() => useTraceStore.getState().clear())

describe('trace store', () => {
  it('keeps log lines with their time and node, and the last value of each pin apart from them', () => {
    const s = useTraceStore.getState()
    s.push('[Inkwell] info log: shown', 1000)
    s.push('[Inkwell] pin c.value = true')
    s.push('[Inkwell] pin c.value = false')
    s.push('plain trace')
    const { lines, pins } = useTraceStore.getState()
    expect(lines.map((l) => l.line)).toEqual([{ kind: 'log', level: 'info', node: 'log', message: 'shown' }, { kind: 'text', message: 'plain trace' }])
    expect(lines[0]!.at).toBe(1000)
    expect(pins).toEqual({ 'c.value': 'false' })
  })
  it('a new build forgets the pin values but not the lines; clear forgets both', () => {
    const s = useTraceStore.getState()
    s.push('[Inkwell] info a: x')
    s.push('[Inkwell] pin a.b = 1')
    s.newBuild()
    expect(useTraceStore.getState().pins).toEqual({})
    expect(useTraceStore.getState().lines).toHaveLength(1)
    s.clear()
    expect(useTraceStore.getState().lines).toHaveLength(0)
  })
  it('counts the runs of each exec node without making a trace line; a new build and clear reset the counts', () => {
    const s = useTraceStore.getState()
    s.push('[Inkwell] run a')
    s.push('[Inkwell] run a')
    s.push('[Inkwell] run b')
    expect(useTraceStore.getState().runs).toEqual({ a: 2, b: 1 })
    expect(useTraceStore.getState().lines).toHaveLength(0)
    s.newBuild()
    expect(useTraceStore.getState().runs).toEqual({})
    s.push('[Inkwell] run a')
    s.clear()
    expect(useTraceStore.getState().runs).toEqual({})
  })
  it('is capped', () => {
    for (let i = 0; i < MAX_TRACE_LINES + 20; i++) useTraceStore.getState().push(`[Inkwell] info n: ${i}`)
    const { lines } = useTraceStore.getState()
    expect(lines).toHaveLength(MAX_TRACE_LINES)
    expect(lines.at(-1)!.line).toMatchObject({ message: String(MAX_TRACE_LINES + 19) })
  })
})
