import { describe, expect, it } from 'vitest'
import { FACES, modeFromEnv, resolvePreviewFonts, ttfFullName } from './previewFonts'
import { KNOWN_ALIASES } from './swf/text'

/** Minimal TTF with only a `name` table holding a full name (ID 4, Windows, UTF-16BE). */
const ttf = (full: string): Buffer => {
  const s = Buffer.from(full, 'utf16le').swap16()
  const name = Buffer.alloc(6 + 12 + s.length)
  name.writeUInt16BE(1, 2) // count
  name.writeUInt16BE(18, 4) // string offset
  name.writeUInt16BE(3, 6); name.writeUInt16BE(1, 8); name.writeUInt16BE(0x409, 10); name.writeUInt16BE(4, 12); name.writeUInt16BE(s.length, 14)
  s.copy(name, 18)
  const head = Buffer.alloc(12 + 16)
  head.writeUInt16BE(1, 4)
  head.write('name', 12, 'latin1'); head.writeUInt32BE(28, 20); head.writeUInt32BE(name.length, 24)
  return Buffer.concat([head, name])
}

const files = (m: Record<string, string>) => (p: string) => {
  const hit = Object.entries(m).find(([k]) => p.split(String.fromCharCode(92)).join('/') === k)
  return hit ? ttf(hit[1]) : undefined
}
const bundled: Record<string, string> = Object.fromEntries([...new Set(FACES.map((f) => f.bundled))].map((f) => [`b/${f}`, `Bundled ${f}`]))
const installed = { 'i/Inkwell-Everywhere-Medium.ttf': 'Everywhere Medium', 'i/Inkwell-Dragon-Regular.ttf': 'Dragon Regular' }

describe('preview font selection', () => {
  const opts = { bundledDir: 'b', installedDir: 'i', read: files({ ...bundled, ...installed }) }

  it('reads a TTF full name', () => {
    expect(ttfFullName(ttf('Everywhere Medium'))).toBe('Everywhere Medium')
    expect(ttfFullName(Buffer.from('nope'))).toBeUndefined()
  })

  it('auto: installed font per face when present, bundled lookalike otherwise', () => {
    const s = resolvePreviewFonts(opts)
    expect(s.nameFor('$EverywhereMediumFont')).toBe('Everywhere Medium')
    expect(s.nameFor('$StartMenuFont')).toBe('Everywhere Medium') // shares the face
    expect(s.nameFor('$DragonFont')).toBe('Dragon Regular')
    expect(s.nameFor('$EverywhereBoldFont')).toBe('Bundled BarlowCondensed-Bold.ttf')
    expect(s.nameFor('$ConsoleFont')).toBe('Bundled ShareTechMono-Regular.ttf')
    expect(s.approximated(['$EverywhereMediumFont', '$EverywhereBoldFont', '$ConsoleFont'])).toEqual(['Everywhere Bold', 'Console'])
  })

  it('bundled forces the lookalikes even when installed fonts exist', () => {
    const s = resolvePreviewFonts({ ...opts, mode: 'bundled' })
    expect(s.nameFor('$EverywhereMediumFont')).toBe('Bundled BarlowCondensed-Regular.ttf')
    expect(s.fonts.every((f) => f.source === 'bundled')).toBe(true)
  })

  it('missing installed fonts (or none installed dir) fall back to bundled, in every mode', () => {
    for (const mode of ['auto', 'installed'] as const)
      for (const dir of [{ installedDir: 'empty' }, {}]) {
        const s = resolvePreviewFonts({ bundledDir: 'b', read: files(bundled), mode, ...dir })
        expect(s.nameFor('$EverywhereMediumFont')).toBe('Bundled BarlowCondensed-Regular.ttf')
        expect(s.approximated(['$EverywhereMediumFont'])).toEqual(['Everywhere Medium'])
      }
  })

  it('installed and unreadable bundled files: unknown alias falls back to _sans', () => {
    expect(resolvePreviewFonts({ bundledDir: 'b', read: () => undefined }).nameFor('$EverywhereFont')).toBe('_sans')
  })

  it('every known alias has a face; every face file is distinct per family only once in fonts', () => {
    const covered = new Set(FACES.flatMap((f) => f.aliases))
    for (const a of KNOWN_ALIASES) expect(covered.has(a), a).toBe(true)
    const s = resolvePreviewFonts(opts)
    expect(new Set(s.fonts.map((f) => f.family)).size).toBe(s.fonts.length)
  })

  it('INKWELL_PREVIEW_FONTS parsing', () => {
    expect(['bundled', 'installed', 'auto', 'x', undefined].map(modeFromEnv)).toEqual(['bundled', 'installed', 'auto', 'auto', 'auto'])
  })
})
