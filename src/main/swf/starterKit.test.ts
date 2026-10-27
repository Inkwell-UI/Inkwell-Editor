import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fontAlias, KNOWN_ALIASES } from './text'

// docs/starter-kit.md must not promise a font name the compiler does not map.
const doc = readFileSync(resolve(__dirname, '../../../docs/starter-kit.md'), 'utf8')

describe('starter kit doc', () => {
  it('names only aliases the compiler knows', () => {
    const named = [...doc.matchAll(/`(\$[A-Za-z_]+Font|\$SkyrimBooks|ControllerButtons)`/g)].map((m) => m[1]!)
    expect(named.length).toBeGreaterThan(8)
    for (const a of named) expect(KNOWN_ALIASES.has(a), a).toBe(true)
  })
  it('its text styles resolve through rule 1', () => {
    const styles = [...doc.matchAll(/^\| `((?:Everywhere|SkyrimBooks) \/ [A-Za-z]+ \/ \d+)` \|/gm)].map((m) => m[1]!)
    expect(styles).toHaveLength(6)
    expect(styles.map((s) => fontAlias(s))).toEqual(['$EverywhereBoldFont', '$EverywhereMediumFont', '$EverywhereMediumFont', '$EverywhereFont', '$EverywhereFont', '$SkyrimBooks'])
  })
})
