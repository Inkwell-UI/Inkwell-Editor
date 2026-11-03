import type { PromptDevice } from '@inkwell-ui/spec'

// The game's own prompt art (S-H..S-M, archive/TEST-IN-GAME-0.5.md): every vanilla menu SWF exports its button icons as sprites (`360_A`, `PS3_A`, `Enter`, ...). A custom menu loads such a menu
// from a loose copy that the runtime writes to Data/Interface/Inkwell/_vanilla/ (`VanillaAssets.cpp`; the archive itself cannot be reached through a `..` path) and attaches the sprite out of its library.
// Nothing of the game's art is stored here: only names. A glyph with no entry below keeps the compiled glyph (font or drawn).

/** The vanilla files the runtime copies; keep in step with `kNames` in Inkwell-Runtime `VanillaAssets.cpp`. */
export const ART_FILES = ['textentry', 'creationclubmenu', 'sharedcomponents'] as const
export type ArtFile = (typeof ART_FILES)[number]

// Which file holds which sprite (found with FFDec in the user's own install, SE 1.7.104). textentry is the smallest and the one tried in game; the rest come from the file that has the most.
const TEXTENTRY = new Set(['360_A', '360_B', 'PS3_A', 'PS3_B', 'Enter', 'Tab'])
const SHARED = new Set(['Shift', 'Ctrl', 'Alt'])
const CLUB = new Set([
  '360_Back', '360_L3', '360_LB', '360_LT', '360_LTRT', '360_R3', '360_RB', '360_RT', '360_Start', '360_X', '360_Y',
  'PS3_Back', 'PS3_L3', 'PS3_LB', 'PS3_LBRB', 'PS3_LT', 'PS3_LTRT', 'PS3_R3', 'PS3_RB', 'PS3_RT', 'PS3_Start', 'PS3_X', 'PS3_Y',
  'C', 'Down', 'E', 'Esc', 'F', 'Left', 'M1M2', 'Q', 'R', 'Right', 'Space', 'T', 'Up', 'X', 'Z'
])

const PS: Record<string, string> = { Cross: 'PS3_A', Circle: 'PS3_B', Square: 'PS3_X', Triangle: 'PS3_Y', L1: 'PS3_LB', R1: 'PS3_RB', L2: 'PS3_LT', R2: 'PS3_RT', Options: 'PS3_Start' }

/** The sprite name of a spec glyph on a device, or undefined (the D-pad and Share have no vanilla sprite). */
export function spriteName(d: PromptDevice, glyph: string): string | undefined {
  if (d === 'xbox') return glyph.startsWith('Dpad') ? undefined : `360_${glyph}`
  if (d === 'playstation') return PS[glyph]
  return glyph.length === 1 ? glyph.toUpperCase() : glyph // keyboard: the key label is the sprite name
}

export function artFor(d: PromptDevice, glyph: string): { file: ArtFile; sprite: string } | undefined {
  const sprite = spriteName(d, glyph)
  if (!sprite) return undefined
  if (TEXTENTRY.has(sprite)) return { file: 'textentry', sprite }
  if (SHARED.has(sprite)) return { file: 'sharedcomponents', sprite }
  if (CLUB.has(sprite)) return { file: 'creationclubmenu', sprite }
  return undefined
}

/** `INKWELL_PROMPT_ART=0` builds the compiled glyphs only (the fallback if a player's game shows blank prompts). */
export const promptArtEnabled = (): boolean => process.env['INKWELL_PROMPT_ART'] !== '0'
