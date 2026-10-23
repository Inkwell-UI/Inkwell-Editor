import { describe, expect, it } from 'vitest'
import type { LintRow } from '../../shared/syncState'
import { buildDockRows, countSeverities, filterDockRows, firstError } from './lintRows'

const l = (over: Partial<LintRow>): LintRow => ({ swfName: 'A', nodeId: '1:1', layerName: 'L', severity: 'warning', code: 'c', message: 'm', ...over })

describe('dock rows', () => {
  it('sorts errors first, merges unreachable nodes and loose layers, gives every row a unique key', () => {
    const rows = buildDockRows({
      lint: [l({}), l({ severity: 'error', code: 'e' }), l({})],
      unreachable: [{ id: '9:9', name: 'Stray', swfName: 'A' }],
      looseLayers: [{ id: '8:8', name: 'Loose' }],
      strict: false
    })
    expect(rows.map((r) => r.severity)).toEqual(['error', 'warning', 'warning', 'warning', 'warning'])
    expect(new Set(rows.map((r) => r.key)).size).toBe(5)
    expect(rows.filter((r) => r.code === 'unreachable-node').map((r) => r.swfName)).toEqual(['A', ''])
  })
  it('strict mode promotes warnings to errors in the displayed list; info stays', () => {
    const rows = buildDockRows({ lint: [l({}), l({ severity: 'info', code: 'i' })], strict: true })
    expect(rows.map((r) => r.severity)).toEqual(['error', 'info'])
  })
  it('a failed build with its own message adds a build-failed error first; a message a lint row already carries does not', () => {
    const rows = buildDockRows({ lint: [l({})], build: 'error', buildError: 'FFDec not found', strict: false })
    expect(rows[0]).toMatchObject({ code: 'build-failed', severity: 'error', message: 'FFDec not found' })
    expect(firstError(rows)).toBe(rows[0])
    const dup = buildDockRows({ lint: [l({ severity: 'error', message: 'boom' })], build: 'error', buildError: 'boom', strict: false })
    expect(dup).toHaveLength(1)
    expect(buildDockRows({ lint: [], build: 'synced', buildError: 'stale', strict: false })).toEqual([])
  })
  it('filters by severity and current swf; project-level rows always stay', () => {
    const rows = buildDockRows({ lint: [l({}), l({ swfName: 'B', severity: 'error' })], build: 'error', buildError: 'x', strict: false })
    expect(filterDockRows(rows, { severity: 'error', currentSwf: 'A' }).map((r) => r.code)).toEqual(['build-failed'])
    expect(filterDockRows(rows, { severity: 'all', currentSwf: 'A' })).toHaveLength(2)
    expect(countSeverities(rows)).toEqual({ errors: 2, warnings: 1 })
  })
})
