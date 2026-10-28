import { describe, expect, it } from 'vitest'
import { ffdecState, formatMs, specLabel, timingLine } from './statusBar'

describe('status bar formatting', () => {
  it('formats ms', () => {
    expect([formatMs(0.2), formatMs(4.26), formatMs(41.4), formatMs(1234)]).toEqual(['<1 ms', '4.3 ms', '41 ms', '1234 ms'])
  })
  it('spec label', () => {
    expect(specLabel(3)).toBe('Spec 0.3')
  })
  it('orders stages, adds the Ruffle time, goes amber above 3000 ms edit-to-preview', () => {
    const l = timingLine({ seq: 1, swfName: 'a', stages: { ffdec: 14, sync: 2, 'preview-build': 9, codegen: 4, swf: 1 }, total: 30, previewMs: 21 })
    expect(l.parts.map((p) => p[0])).toEqual(['sync', 'codegen', 'swf', 'ffdec', 'preview-build', 'preview'])
    expect(l.total).toBe('51 ms')
    expect(l.amber).toBe(false)
    expect(timingLine({ seq: 2, swfName: 'a', stages: {}, total: 3001 }).amber).toBe(true)
  })
  it('ffdec state', () => {
    expect(ffdecState({ installed: false, jarBuilt: true, javaOk: true, everBuilt: true })).toEqual({ status: 'notFound', reason: 'ffdec' })
    expect(ffdecState({ installed: true, jarBuilt: false, javaOk: true, everBuilt: true })).toEqual({ status: 'notFound', reason: 'wrapper' })
    expect(ffdecState({ installed: true, jarBuilt: true, javaOk: false, everBuilt: false })).toEqual({ status: 'notFound', reason: 'java' })
    expect(ffdecState({ installed: true, jarBuilt: true, javaOk: true, everBuilt: false })).toEqual({ status: 'cold' })
    expect(ffdecState({ installed: true, jarBuilt: true, javaOk: true, everBuilt: true })).toEqual({ status: 'warm' })
  })
})
