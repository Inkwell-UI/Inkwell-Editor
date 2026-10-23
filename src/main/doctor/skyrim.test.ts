import { describe, expect, it } from 'vitest'
import { findSkyrim, parseGogSkyrim, parseLibraryFolders, parseRegValue, runtimeLabel } from './skyrim'

const VDF = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"apps" { "228980" "1" }
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
	}
}`

describe('skyrim detection', () => {
  it('parses a registry value', () => {
    expect(parseRegValue('\nHKEY_X\n    InstallPath    REG_SZ    C:\\Program Files (x86)\\Steam\n', 'InstallPath')).toBe('C:\\Program Files (x86)\\Steam')
    expect(parseRegValue('nothing', 'InstallPath')).toBeUndefined()
  })
  it('parses libraryfolders.vdf (escapes, dedupe, Steam first)', () => {
    expect(parseLibraryFolders(VDF, 'C:\\Program Files (x86)\\Steam')).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary'])
    expect(parseLibraryFolders('', 'C:\\S')).toEqual(['C:\\S'])
  })
  it('finds the GOG Skyrim SE entry among other games', () => {
    const out = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\111
    gameName    REG_SZ    The Witcher 3
    path    REG_SZ    C:\\GOG\\Witcher
HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1162721350
    gameName    REG_SZ    The Elder Scrolls V: Skyrim Special Edition
    path    REG_SZ    C:\\GOG Games\\Skyrim Special Edition
`
    expect(parseGogSkyrim(out)).toBe('C:\\GOG Games\\Skyrim Special Edition')
    expect(parseGogSkyrim('')).toBeUndefined()
  })
  it('collects manual, Steam libraries and GOG, only where SkyrimSE.exe exists', async () => {
    const present = new Set(['e:\\manual\\skyrimse.exe', 'd:\\steamlibrary\\steamapps\\common\\skyrim special edition\\skyrimse.exe', 'c:\\gog\\skyrimse.exe'])
    const c = await findSkyrim({
      manual: 'E:\\manual',
      exists: (p) => present.has(p.toLowerCase()),
      read: async () => VDF,
      exec: async (_c, a) => (a[1]!.includes('Valve') ? 'InstallPath    REG_SZ    C:\\Program Files (x86)\\Steam' : 'HKEY_A\n gameName    REG_SZ    Skyrim Special Edition\n path    REG_SZ    C:\\GOG')
    })
    expect(c.map((x) => x.source)).toEqual(['manual', 'steam', 'gog'])
    expect(c[1]!.path).toBe('D:\\SteamLibrary\\steamapps\\common\\Skyrim Special Edition')
  })
  it('nothing found when reg fails', async () => {
    expect(await findSkyrim({ exists: () => true, exec: async () => Promise.reject(new Error('x')) })).toEqual([])
  })
  it('runtime table: known, family-only and unknown are reported honestly', () => {
    expect(runtimeLabel('1.5.97.0')).toEqual({ label: 'SE 1.5.97', known: true })
    expect(runtimeLabel('1.6.1170.0')).toMatchObject({ known: true })
    expect(runtimeLabel('1.6.9999.0')).toMatchObject({ known: false, label: expect.stringContaining('not in Inkwell') })
    expect(runtimeLabel('1.7.2.0').label).toContain('1.7.x')
    expect(runtimeLabel('2.0.0.0')).toEqual({ label: 'unknown runtime 2.0.0.0', known: false })
  })
})
