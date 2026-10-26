// "Install Skyrim fonts for Figma" (opt-in, local only): the faces it installs and the IPC shapes. docs/font-install.md.

export interface FigmaFace {
  /** Name ID 1 of FFDec's raw export and its bold flag (head.macStyle bit 0): how the raw file is recognised. */
  raw: { name: string; bold: boolean }
  /** Figma family / style; family/style maps to the alias through font-resolution rule 2 (`fontAlias` in main/swf/text.ts). */
  family: string
  style: string
  weight: number
  aliases: string[]
}

/**
 * Every DefineFont3 of Interface/fonts_en.swf (Skyrim 1.7.104) that Windows lacks, aliases per vanilla fontconfig.txt. Skipped: Consolas
 * (`$ConsoleFont`; Microsoft's, not a DefineFont3 there). SkyrimBooks_Gaelic is `$SkyrimBooks` (no `Font` suffix); the controller-button aliases
 * have no `$` at all (`ControllerButtons`). Raw names are FFDec's name ID 1 (note the double space in "Controller  Buttons").
 */
export const FIGMA_FACES: readonly FigmaFace[] = [
  { raw: { name: 'Futura CondensedLight', bold: false }, family: 'Everywhere', style: 'Light', weight: 300, aliases: ['$EverywhereFont', '$DialogueFont'] },
  { raw: { name: 'Futura Condensed', bold: false }, family: 'Everywhere', style: 'Medium', weight: 500, aliases: ['$EverywhereMediumFont', '$StartMenuFont'] },
  { raw: { name: 'Futura Condensed', bold: true }, family: 'Everywhere', style: 'Bold', weight: 700, aliases: ['$EverywhereBoldFont'] },
  { raw: { name: 'Dragon_script', bold: false }, family: 'Dragon', style: 'Regular', weight: 400, aliases: ['$DragonFont'] },
  { raw: { name: 'SkyrimBooks_Handwritten_Bold', bold: false }, family: 'Handwritten', style: 'Regular', weight: 400, aliases: ['$HandwrittenFont', '$HandwrittenBold'] },
  { raw: { name: 'Falmer', bold: false }, family: 'Falmer', style: 'Regular', weight: 400, aliases: ['$FalmerFont'] },
  { raw: { name: 'Dwemer', bold: false }, family: 'Dwemer', style: 'Regular', weight: 400, aliases: ['$DwemerFont'] },
  { raw: { name: 'Daedric', bold: false }, family: 'Daedric', style: 'Regular', weight: 400, aliases: ['$DaedricFont'] },
  { raw: { name: 'Mage Script', bold: false }, family: 'MageScript', style: 'Regular', weight: 400, aliases: ['$MageScriptFont'] },
  { raw: { name: 'SkyrimSymbols', bold: false }, family: 'SkyrimSymbols', style: 'Regular', weight: 400, aliases: ['$SkyrimSymbolsFont'] },
  { raw: { name: 'SkyrimBooks_Gaelic', bold: false }, family: 'SkyrimBooks', style: 'Regular', weight: 400, aliases: ['$SkyrimBooks'] },
  { raw: { name: 'SkyrimBooks_Unreadable', bold: false }, family: 'SkyrimBooksUnreadable', style: 'Regular', weight: 400, aliases: ['$SkyrimBooks_UnreadableFont'] },
  { raw: { name: 'Eurostile LT Cyr Std', bold: false }, family: 'CreationClub', style: 'Regular', weight: 400, aliases: ['$CClub_Font'] },
  { raw: { name: 'Eurostile Cyr Std', bold: true }, family: 'CreationClub', style: 'Bold', weight: 700, aliases: ['$CClub_Font_Bold'] },
  { raw: { name: 'Controller  Buttons', bold: false }, family: 'ControllerButtons', style: 'Regular', weight: 400, aliases: ['ControllerButtons'] },
  { raw: { name: 'Controller  Buttons inverted', bold: false }, family: 'ControllerButtonsInverted', style: 'Regular', weight: 400, aliases: ['ControllerButtonsInverted'] }
]

/** PostScript-style name, also the file stem: `Everywhere-Light`. The installed file is `Inkwell-<psName>.ttf` (what previewFonts.ts looks for). */
export const psName = (f: { family: string; style: string }): string => `${f.family}-${f.style}`
export const installedFileName = (f: { family: string; style: string }): string => `Inkwell-${psName(f)}.ttf`
/** HKCU Fonts value name. */
export const registryName = (f: { family: string; style: string }): string => `${f.family} ${f.style} (TrueType)`

/** An embedded custom font of the project (SPEC-CHANGES V5), as the Inspector shows it. */
export interface ProjectFontInfo {
  hash: string
  family: string
  /** The file name the author picked. */
  source?: string
  charsets: string[]
  extraChars: string
  /** OS/2 fsType and its verdict (V5.3). */
  fsType: number
  fsTypeLabel: string
  license: { level: 'ok' | 'warning' | 'error'; text?: string }
  /** The font's licence description (name ID 13), when it has one. */
  licenseText?: string
  glyphCount: number
  bytes: number
  /** The file is gone or unreadable. */
  error?: string
}
export type ProjectFontsState = { fonts: ProjectFontInfo[]; error?: string }
export type AddFontOutcome = { ok: true; font: ProjectFontInfo; existed: boolean } | { ok: false; error: string; cancelled?: boolean }

export interface InstalledFace {
  family: string
  style: string
  /** Absolute path of the installed file. */
  file: string
  /** False when the file listed in the manifest is gone. */
  present: boolean
  /** Characters the installed font maps (cmap); undefined when the file is gone or unreadable. A sparse symbol font shows here. */
  glyphs?: number
  /** The mapped characters themselves when there are few (<= 64), so a sparse font is visible. */
  chars?: string
}

/** A face of FIGMA_FACES that the manifest does not list yet. */
export interface MissingFace {
  family: string
  style: string
  aliases: string[]
}

export interface FontToolStatus {
  platformOk: boolean
  installed: boolean
  faces: InstalledFace[]
  /** Faces this version knows that the manifest lacks (all before the first install; the new ones after an update). */
  missing: MissingFace[]
  fontsDir: string
  manifestPath: string
}

export type FontToolErrorCode = 'not-windows' | 'busy' | 'already-installed' | 'game-not-found' | 'ffdec-missing' | 'export-failed' | 'faces-missing' | 'fstype' | 'foreign' | 'failed'
export type FontToolResult = { ok: true; status: FontToolStatus; warnings: string[] } | { ok: false; code: FontToolErrorCode; error: string; status: FontToolStatus }

export type FontToolStep = 'game' | 'export' | 'convert' | 'install' | 'remove'
export interface FontToolProgress {
  step: FontToolStep
  done?: number
  total?: number
}

/** The faces of FIGMA_FACES whose family/style is not in `have`. */
export const missingFaces = (have: readonly { family: string; style: string }[]): MissingFace[] =>
  FIGMA_FACES.filter((f) => !have.some((h) => h.family === f.family && h.style === f.style)).map((f) => ({ family: f.family, style: f.style, aliases: f.aliases }))

/** Named character ranges the author can ship on top of the characters the texts use (V5.1). */
export const CHARSETS = {
  basicLatin: { label: 'Basic Latin', ranges: [[0x20, 0x7e]] },
  latin1: { label: 'Latin-1 (accents of Western Europe)', ranges: [[0xa0, 0xff]] },
  latinExtendedA: { label: 'Latin Extended-A (Central Europe)', ranges: [[0x100, 0x17f]] },
  cyrillic: { label: 'Cyrillic', ranges: [[0x400, 0x4ff]] }
} as const satisfies Record<string, { label: string; ranges: readonly (readonly [number, number])[] }>
export type CharsetId = keyof typeof CHARSETS
export const isCharsetId = (s: string): s is CharsetId => Object.hasOwn(CHARSETS, s)
