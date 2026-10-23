import { describe, expect, it } from 'vitest'
import { createStageTimer } from './timing'

function clock() {
  let t = 0
  return { now: () => t, tick: (n: number) => (t += n) }
}

describe('createStageTimer', () => {
  it('measures stages and total', () => {
    const c = clock()
    const timer = createStageTimer({ now: c.now })
    timer.start('codegen')
    c.tick(5)
    expect(timer.end('codegen')).toBe(5)
    c.tick(2) // gap counts toward total only
    timer.start('ffdec')
    c.tick(20)
    timer.end('ffdec')
    expect(timer.finishBuild()).toEqual({ stages: { codegen: 5, ffdec: 20 }, total: 27 })
  })

  it('keeps only the last N builds', () => {
    const c = clock()
    const timer = createStageTimer({ now: c.now, keep: 2 })
    for (const n of [1, 2, 3]) {
      timer.start('s')
      c.tick(n)
      timer.end('s')
      timer.finishBuild()
    }
    expect(timer.builds().map((b) => b.total)).toEqual([2, 3])
  })

  it('rejects misuse', () => {
    const timer = createStageTimer()
    expect(() => timer.end('x')).toThrow()
    expect(() => timer.finishBuild()).toThrow()
    timer.start('x')
    expect(() => timer.finishBuild()).toThrow()
  })
})
