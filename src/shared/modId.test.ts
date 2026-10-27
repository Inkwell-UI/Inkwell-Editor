import { describe, expect, it } from 'vitest'
import { cleanModId, MOD_ID } from './modId'

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
