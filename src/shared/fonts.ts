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
 * Faces of Interface/fonts_en.swf (Skyrim 1.7.104) the tool installs, aliases per vanilla fontconfig.txt. Skipped: Consolas (Microsoft's), the
 * controller/CClub/Unreadable fonts. SkyrimBooks_Gaelic is `$SkyrimBooks` (the one alias without the `Font` suffix).
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
  { raw: { name: 'SkyrimBooks_Gaelic', bold: false }, family: 'SkyrimBooks', style: 'Regular', weight: 400, aliases: ['$SkyrimBooks'] }
]

/** PostScript-style name, also the file stem: `Everywhere-Light`. The installed file is `Inkwell-<psName>.ttf` (what previewFonts.ts looks for). */
export const psName = (f: { family: string; style: string }): string => `${f.family}-${f.style}`
export const installedFileName = (f: { family: string; style: string }): string => `Inkwell-${psName(f)}.ttf`
/** HKCU Fonts value name. */
export const registryName = (f: { family: string; style: string }): string => `${f.family} ${f.style} (TrueType)`

export interface InstalledFace {
  family: string
  style: string
  /** Absolute path of the installed file. */
  file: string
  /** False when the file listed in the manifest is gone. */
  present: boolean
}

export interface FontToolStatus {
  platformOk: boolean
  installed: boolean
  faces: InstalledFace[]
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
