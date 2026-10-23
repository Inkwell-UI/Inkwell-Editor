import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where the preview text gets its font from. `auto` = installed Skyrim fonts when present, else a bundled lookalike, per face. */
export type PreviewFontMode = 'auto' | 'installed' | 'bundled'

export interface FontFace {
  /** Skyrim font aliases drawn with this face. */
  aliases: string[]
  /** Badge label. */
  label: string
  /** File the opt-in font tool installs (per user), if the game font is known to it. */
  installed?: string
  /** Bundled OFL lookalike in resources/preview-fonts. */
  bundled: string
  /** Bundled lookalike is a generic stand-in (no measured match), so the badge lists the face as approximated. */
  generic?: boolean
}

const SANS = 'BarlowCondensed-Regular.ttf'
/** Alias -> face table. Measured lookalikes: docs/preview-fonts.md. */
export const FACES: readonly FontFace[] = [
  { aliases: ['$EverywhereFont'], label: 'Everywhere Light', installed: 'Inkwell-Everywhere-Light.ttf', bundled: 'BarlowCondensed-Light.ttf' },
  { aliases: ['$EverywhereMediumFont', '$StartMenuFont', '$DialogueFont'], label: 'Everywhere Medium', installed: 'Inkwell-Everywhere-Medium.ttf', bundled: 'BarlowCondensed-Regular.ttf' },
  { aliases: ['$EverywhereBoldFont'], label: 'Everywhere Bold', installed: 'Inkwell-Everywhere-Bold.ttf', bundled: 'BarlowCondensed-Bold.ttf' },
  { aliases: ['$HandwrittenFont'], label: 'Handwritten', installed: 'Inkwell-Handwritten-Regular.ttf', bundled: SANS, generic: true },
  { aliases: ['$DragonFont'], label: 'Dragon', installed: 'Inkwell-Dragon-Regular.ttf', bundled: SANS, generic: true },
  { aliases: ['$FalmerFont'], label: 'Falmer', installed: 'Inkwell-Falmer-Regular.ttf', bundled: SANS, generic: true },
  { aliases: ['$DwemerFont'], label: 'Dwemer', installed: 'Inkwell-Dwemer-Regular.ttf', bundled: SANS, generic: true },
  { aliases: ['$DaedricFont'], label: 'Daedric', installed: 'Inkwell-Daedric-Regular.ttf', bundled: SANS, generic: true },
  { aliases: ['$MageScriptFont'], label: 'MageScript', installed: 'Inkwell-MageScript-Regular.ttf', bundled: SANS, generic: true },
  { aliases: ['$SkyrimSymbolsFont'], label: 'Skyrim Symbols', installed: 'Inkwell-SkyrimSymbols-Regular.ttf', bundled: SANS, generic: true },
  { aliases: ['$ConsoleFont'], label: 'Console', bundled: 'ShareTechMono-Regular.ttf', generic: true }
]

export interface PreviewFont {
  face: FontFace
  source: 'installed' | 'bundled'
  /** Name Ruffle resolves the font by (the font's full name, name ID 4). */
  family: string
  bytes: Buffer
}

export interface PreviewFontSet {
  /** One per distinct file; these are the only bytes that leave the main process (as the font blob). */
  fonts: PreviewFont[]
  /** Device font name for an alias; `_sans` for an alias no face covers. */
  nameFor(alias: string): string
  /** Badge labels of the faces used by `aliases` that are not the real Skyrim font. */
  approximated(aliases: Iterable<string>): string[]
}

/** Full font name (name ID 4, Windows platform, UTF-16BE) of a TTF; undefined if absent or not a TrueType file. */
export function ttfFullName(b: Buffer): string | undefined {
  try {
    const n = b.readUInt16BE(4)
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16
      if (b.toString('latin1', o, o + 4) !== 'name') continue
      const t = b.readUInt32BE(o + 8)
      const count = b.readUInt16BE(t + 2)
      const strings = t + b.readUInt16BE(t + 4)
      for (let r = 0; r < count; r++) {
        const q = t + 6 + r * 12
        if (b.readUInt16BE(q) === 3 && b.readUInt16BE(q + 6) === 4) {
          const len = b.readUInt16BE(q + 8)
          const s = Buffer.from(b.subarray(strings + b.readUInt16BE(q + 10), strings + b.readUInt16BE(q + 10) + len)).swap16()
          return s.toString('utf16le')
        }
      }
    }
  } catch {
    /* corrupt or truncated file: treated as absent */
  }
  return undefined
}

export interface ResolveOptions {
  mode?: PreviewFontMode
  /** %LOCALAPPDATA%\Microsoft\Windows\Fonts; read-only. */
  installedDir?: string
  bundledDir: string
  /** Tests inject a fake file system; returns undefined when the file is missing. */
  read?: (path: string) => Buffer | undefined
}

const readOrUndefined = (p: string): Buffer | undefined => {
  try {
    return readFileSync(p)
  } catch {
    return undefined
  }
}

/** `INKWELL_PREVIEW_FONTS=bundled|installed|auto`; anything else is auto. */
export const modeFromEnv = (v: string | undefined): PreviewFontMode => (v === 'bundled' || v === 'installed' ? v : 'auto')

/** Installed fonts live in the user's font folder; the tool that installs them is opt-in, so absence is normal. */
export const defaultInstalledDir = (env: NodeJS.ProcessEnv = process.env): string | undefined =>
  env['LOCALAPPDATA'] ? join(env['LOCALAPPDATA'], 'Microsoft', 'Windows', 'Fonts') : undefined

/**
 * Picks a file per face: installed Skyrim font (mode auto|installed, when readable and named), else the bundled lookalike (mode auto|bundled).
 * Mode `installed` with a missing file still falls back to the bundled one so text never vanishes.
 */
export function resolvePreviewFonts(o: ResolveOptions): PreviewFontSet {
  const read = o.read ?? readOrUndefined
  const mode = o.mode ?? 'auto'
  const byAlias = new Map<string, PreviewFont>()
  const load = (dir: string, file: string, face: FontFace, source: PreviewFont['source']): PreviewFont | undefined => {
    const bytes = read(join(dir, file))
    const family = bytes && ttfFullName(bytes)
    if (!bytes || !family) return undefined
    return { face, source, family, bytes }
  }
  for (const face of FACES) {
    const inst = mode !== 'bundled' && o.installedDir && face.installed ? load(o.installedDir, face.installed, face, 'installed') : undefined
    const f = inst ?? load(o.bundledDir, face.bundled, face, 'bundled')
    if (f) for (const a of face.aliases) byAlias.set(a, f)
  }
  return {
    fonts: [...new Map([...byAlias.values()].map((f) => [f.family, f])).values()],
    nameFor: (alias) => byAlias.get(alias)?.family ?? '_sans',
    approximated: (aliases) => [...new Set([...aliases].flatMap((a) => { const f = byAlias.get(a); return f && (f.source === 'bundled') ? [f.face.label] : [] }))]
  }
}
