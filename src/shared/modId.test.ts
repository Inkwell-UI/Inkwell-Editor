import { describe, expect, it } from 'vitest'
import { cleanModId, MOD_ID, modIdProblem } from './modId'

describe('cleanModId', () => {
  it('removes bad characters instead of replacing them', () => {
    expect(cleanModId('Skyrim Stopwatch')).toBe('SkyrimStopwatch')
    expect(cleanModId('Skyrim_Stopwatch')).toBe('SkyrimStopwatch')
    expect(cleanModId('my-mod.v2!')).toBe('mymodv2')
    expect(cleanModId('Zurücksetzen')).toBe('Zurcksetzen')
  })
  it('leaves a valid id alone and is idempotent', () => {
    for (const s of ['InkwellStopwatch', 'A', 'mod2']) expect(cleanModId(s)).toBe(s)
    expect(cleanModId(cleanModId('a b_c'))).toBe('abc')
  })
  it('always returns a valid id (empty or starting with a digit gets a Mod prefix)', () => {
    for (const s of ['', '___', '123', '2fast', ' ']) expect(MOD_ID.test(cleanModId(s))).toBe(true)
    expect(cleanModId('2fast')).toBe('Mod2fast')
    expect(cleanModId('')).toBe('Mod')
  })
})

describe('modIdProblem (the Mod id field)', () => {
  it('is quiet for exactly the ids MOD_ID accepts', () => {
    for (const s of ['InkwellStopwatch', 'A', 'mod2']) expect(modIdProblem(s)).toBeUndefined()
    for (const s of ['', '2fast', '_a', 'a b', 'a_b', 'Zurück', 'a-b.c']) {
      expect(modIdProblem(s)).toBeDefined()
      expect(MOD_ID.test(s)).toBe(false)
    }
  })
  it('names what is wrong', () => {
    expect(modIdProblem('')).toMatch(/empty/)
    expect(modIdProblem('2fast')).toMatch(/start with a letter/)
    expect(modIdProblem('My Mod_v2')).toBe('Letters and digits only; remove the space, "_".')
  })
})
