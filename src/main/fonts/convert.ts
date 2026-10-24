import { FIGMA_FACES, psName, type FigmaFace } from '../../shared/fonts'
import { buildNameTable, nameString, readSfnt, writeSfnt } from './sfnt'

// Port of the spike's fix-fonts.py: recognise FFDec's raw TTF export, rename it to the Figma scheme (Everywhere/Light ...), normalise metrics.

export const NAME_NOTE = "Extracted from the user's own Skyrim install for personal design use. Not redistributable. See Skyrim EULA."

/**
 * OS/2 fsType embedding bits that forbid installing the font permanently: 0x2 restricted, 0x4 preview & print, 0x8 editable.
 * Only 0 ("installable") allows a permanent install (OpenType OS/2 spec). FFDec always writes 0 (SWF fonts carry no flags), so this is a guard.
 */
export const FSTYPE_FORBIDS_INSTALL = 0x000e
export const fsTypeLabel = (v: number): string => (v & 0x2 ? 'restricted licence' : v & 0x4 ? 'preview & print' : v & 0x8 ? 'editable' : 'installable')

export interface ConvertedFont {
  face: FigmaFace
  fsType: number
  bytes: Buffer
}

/** Which scheme face a raw FFDec file is (name ID 1 + bold flag); undefined for fonts the tool does not install. */
export function matchFace(raw: Buffer): FigmaFace | undefined {
  const t = readSfnt(raw)
  const name = t.get('name')
  const head = t.get('head')
  if (!name || !head) return undefined
  const n1 = nameString(name, 1)
  const bold = (head.readUInt16BE(44) & 1) === 1
  return FIGMA_FACES.find((f) => f.raw.name === n1 && f.raw.bold === bold)
}

/** fsType of a TrueType file (0 when it has no OS/2 table). */
export const fsTypeOf = (b: Buffer): number => readSfnt(b).get('OS/2')?.readUInt16BE(8) ?? 0

/** Renames and normalises one raw file for `face`. Does not apply the fsType gate (the caller refuses the whole install). */
export function convertFont(raw: Buffer, face: FigmaFace): ConvertedFont {
  const t = readSfnt(raw)
  const os2 = t.get('OS/2')
  const head = t.get('head')
  const hhea = t.get('hhea')
  const name = t.get('name')
  if (!os2 || os2.length < 78 || !head || head.length < 54 || !hhea || hhea.length < 36 || !name) throw new Error(`${face.raw.name}: OS/2, head, hhea or name table missing or short`)
  const fsType = os2.readUInt16BE(8)
  const cop = (nameString(name, 0) ?? '').replace(/�/g, '(c)').split(', FFDec')[0]!.trim()
  const ps = psName(face)
  const full = face.style === 'Regular' ? face.family : `${face.family} ${face.style}`
  // ID1/2 make every face its own legacy (GDI) family; ID16/17 group them as Everywhere / Light|Medium|Bold
  t.set('name', buildNameTable({ 0: cop, 1: full, 2: 'Regular', 3: `Inkwell extract: ${ps}`, 4: full, 5: 'Version 1.0', 6: ps, 13: NAME_NOTE, 16: face.family, 17: face.style }))
  os2.writeUInt16BE(Math.max(os2.readUInt16BE(0), 4), 0) // v2 and v4 have the same 96-byte layout
  os2.writeUInt16BE(face.weight, 4)
  os2.writeUInt16BE(0x40 | 0x80, 62) // REGULAR | USE_TYPO_METRICS
  const ascent = hhea.readInt16BE(4)
  const descent = hhea.readInt16BE(6)
  hhea.writeInt16BE(0, 8) // lineGap
  os2.writeInt16BE(ascent, 68)
  os2.writeInt16BE(descent, 70)
  os2.writeInt16BE(0, 72)
  os2.writeUInt16BE(ascent, 74)
  os2.writeUInt16BE(-descent, 76)
  head.writeUInt16BE(0, 44) // macStyle: every face is its own Regular
  t.set('head', head.subarray(0, 54)) // FFDec pads head to 56 bytes
  t.delete('hdmx') // device metrics for the old advance widths; stale after the metric changes
  return { face, fsType, bytes: writeSfnt(t) }
}
