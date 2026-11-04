/** Filter box rule: every word of the query appears (case-insensitive) in at least one of the texts. An empty query matches everything. */
export function matchesQuery(query: string, ...texts: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = texts.join('\n').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/**
 * Command palette rule: undefined = no match; otherwise a score where lower is better. A substring wins over letters in order ("dpl" finds "Deploy" and "Dev deploy"),
 * an earlier substring wins over a later one, a shorter text over a longer one.
 */
export function fuzzyScore(query: string, text: string): number | undefined {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const t = text.toLowerCase()
  const at = t.replace(/\s+/g, ' ').indexOf(query.toLowerCase().trim())
  if (at >= 0) return at + t.length / 1000
  let from = 0
  let gaps = 0
  for (const ch of q) {
    const i = t.indexOf(ch, from)
    if (i < 0) return undefined
    gaps += i - from
    from = i + 1
  }
  return 100 + gaps + t.length / 1000
}
