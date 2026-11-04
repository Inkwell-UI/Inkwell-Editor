import { describe, expect, it } from 'vitest'
import { fuzzyScore, matchesQuery } from './filter'

describe('matchesQuery', () => {
  it('needs every word in some text, ignoring case; empty matches all', () => {
    expect(matchesQuery('', 'x')).toBe(true)
    expect(matchesQuery('  ', 'x')).toBe(true)
    expect(matchesQuery('hud pla', 'Player HUD')).toBe(true)
    expect(matchesQuery('hud foo', 'Player HUD')).toBe(false)
    expect(matchesQuery('menu', 'Layer', 'MainMenu')).toBe(true)
  })
})

describe('fuzzyScore', () => {
  it('ranks substring before letters in order, earlier and shorter first, and drops non-matches', () => {
    const s = (t: string): number => fuzzyScore('dep', t)!
    expect(s('Deploy')).toBeLessThan(s('Dev deploy'))
    expect(s('Dev deploy')).toBeLessThan(fuzzyScore('dpl', 'Deploy')! + 1000)
    expect(fuzzyScore('dpl', 'Deploy')).toBeGreaterThanOrEqual(100)
    expect(fuzzyScore('zz', 'Deploy')).toBeUndefined()
    expect(fuzzyScore('', 'Deploy')).toBe(0)
  })
})
