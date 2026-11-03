import { describe, expect, it } from 'vitest'
import { artFor, spriteName } from './promptArt'

describe('promptArt', () => {
  it('maps the spec glyph names to the vanilla sprite names', () => {
    expect(spriteName('xbox', 'A')).toBe('360_A')
    expect(spriteName('playstation', 'Cross')).toBe('PS3_A')
    expect(spriteName('playstation', 'Triangle')).toBe('PS3_Y')
    expect(spriteName('keyboard', 'e')).toBe('E')
    expect(spriteName('keyboard', 'Enter')).toBe('Enter')
  })
  it('has no sprite for the D-pad, Share or an unknown key (the compiled glyph stays)', () => {
    expect(artFor('xbox', 'DpadUp')).toBeUndefined()
    expect(artFor('playstation', 'Share')).toBeUndefined()
    expect(artFor('keyboard', 'Banana')).toBeUndefined()
  })
  it('picks the smallest file that holds the sprite', () => {
    expect(artFor('xbox', 'A')).toEqual({ file: 'textentry', sprite: '360_A' })
    expect(artFor('keyboard', 'Enter')?.file).toBe('textentry')
    expect(artFor('xbox', 'Start')?.file).toBe('creationclubmenu')
    expect(artFor('keyboard', 'Shift')?.file).toBe('sharedcomponents')
  })
})
