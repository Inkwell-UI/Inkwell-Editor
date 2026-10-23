import { describe, expect, it } from 'vitest'
import { addBuild, attachPreview, editToPreview, HISTORY_KEEP, isOverTarget, type BuildRecord } from './timingHistory'

const rec = (seq: number, total = 40, previewMs?: number): BuildRecord => ({ seq, swfName: 'a', stages: { sync: 1 }, total, ...(previewMs === undefined ? {} : { previewMs }) })

describe('timing history', () => {
  it('keeps the last 50, oldest dropped', () => {
    let h: BuildRecord[] = []
    for (let i = 1; i <= 60; i++) h = addBuild(h, rec(i))
    expect(h).toHaveLength(HISTORY_KEEP)
    expect(h[0]!.seq).toBe(11)
    expect(h.at(-1)!.seq).toBe(60)
  })
  it('the same seq replaces, not duplicates', () => {
    expect(addBuild([rec(1, 10)], rec(1, 20))).toEqual([rec(1, 20)])
  })
  it('attaches the preview time to its build only', () => {
    const h = attachPreview([rec(1), rec(2)], 2, 21)
    expect(h[0]!.previewMs).toBeUndefined()
    expect(editToPreview(h[1]!)).toBe(61)
  })
  it('over target means edit-to-preview above 1000 ms', () => {
    expect(isOverTarget(rec(1, 990, 10))).toBe(false)
    expect(isOverTarget(rec(1, 990, 11))).toBe(true)
    expect(isOverTarget(undefined)).toBe(false)
  })
})
