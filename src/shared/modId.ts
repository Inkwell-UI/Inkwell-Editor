/**
 * The mod id becomes a Papyrus script name and part of file and AS2 class names, so it is ASCII letters and digits only, starting with a letter (never `_`, never a space).
 * Bad characters are removed, not replaced: "Skyrim Stopwatch" and "Skyrim_Stopwatch" both become "SkyrimStopwatch". Idempotent; an id that is already valid is returned as is.
 */
export const MOD_ID = /^[A-Za-z][A-Za-z0-9]*$/

/** Why `s` is not a valid mod id (the Mod id field's live check), or undefined when it is. */
export function modIdProblem(s: string): string | undefined {
  if (s === '') return 'The mod id cannot be empty.'
  if (!/^[A-Za-z]/.test(s)) return 'The mod id must start with a letter.'
  const bad = [...new Set(s.replace(/[A-Za-z0-9]/g, ''))]
  if (bad.length) return `Letters and digits only; remove ${bad.map((c) => (c === ' ' ? 'the space' : `"${c}"`)).join(', ')}.`
  return undefined
}

export function cleanModId(s: string): string {
  const t = s.replace(/[^A-Za-z0-9]/g, '')
  return MOD_ID.test(t) ? t : `Mod${t}` // empty, or it starts with a digit
}
