import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIGMA_FACES, installedFileName, registryName, type FigmaFace, type FontToolProgress } from '../../shared/fonts'
import { ttfFullName } from '../previewFonts'
import { fontAlias } from '../swf/text'
import { buildBsa } from '../vanilla/bsa.testutil'
import { convertFont, fsTypeOf, matchFace, NAME_NOTE, type ConvertedFont } from './convert'
import { createFontTool } from './index'
import { fontStatus, installFonts, readManifest, uninstallFonts, type FontSystem } from './install'
import { buildNameTable, nameString, readSfnt, writeSfnt } from './sfnt'

/** A tiny synthetic TrueType file shaped like FFDec's raw export (head padded to 56 bytes, OS/2 v2, hdmx, FFDec-style names). No real font data. */
function rawFont(o: { name: string; bold?: boolean; fsType?: number }): Buffer {
  const head = Buffer.alloc(56)
  head.writeUInt32BE(0x00010000, 0)
  head.writeUInt32BE(0x5f0f3cf5, 12)
  head.writeUInt16BE(1024, 18)
  head.writeUInt16BE(o.bold ? 1 : 0, 44)
  const hhea = Buffer.alloc(36)
  hhea.writeUInt32BE(0x00010000, 0)
  hhea.writeInt16BE(984, 4)
  hhea.writeInt16BE(-227, 6)
  hhea.writeInt16BE(170, 8)
  const os2 = Buffer.alloc(96)
  os2.writeUInt16BE(2, 0)
  os2.writeUInt16BE(400, 4)
  os2.writeUInt16BE(o.fsType ?? 0, 8)
  const name = buildNameTable({ 0: '\ufffd Copyright Test Foundry, FFDec v.26.3.0.', 1: o.name, 2: 'Regular', 8: 'FFDec v.26.3.0' })
  return writeSfnt(new Map([['head', head], ['hhea', hhea], ['OS/2', os2], ['name', name], ['maxp', Buffer.alloc(6)], ['hdmx', Buffer.alloc(8)]]))
}
const rawFor = (f: FigmaFace, fsType = 0): Buffer => rawFont({ name: f.raw.name, bold: f.raw.bold, fsType })
const face = (family: string, style: string): FigmaFace => FIGMA_FACES.find((f) => f.family === family && f.style === style)!

/** In-memory HKCU Fonts key. */
function memRegistry(failSetAfter = Infinity): { values: Map<string, string>; regGet: FontSystem['regGet']; regSet: FontSystem['regSet']; regDelete: FontSystem['regDelete'] } {
  const values = new Map<string, string>()
  let sets = 0
  return {
    values,
    regGet: async (n) => values.get(n),
    regSet: async (n, v) => {
      if (++sets > failSetAfter) throw new Error('access denied (injected)')
      values.set(n, v)
    },
    regDelete: async (n) => void values.delete(n)
  }
}

let dir: string
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'inkwell-fonttest-'))))
afterEach(() => rm(dir, { recursive: true, force: true }))
const sysWith = (reg = memRegistry()): FontSystem & { values: Map<string, string> } => ({ fontsDir: join(dir, 'Fonts'), manifestPath: join(dir, 'Inkwell', 'manifest.json'), ...reg })

describe('sfnt', () => {
  it('round-trips tables and sets a valid checkSumAdjustment', () => {
    const b = rawFont({ name: 'X' })
    const t = readSfnt(b)
    expect([...t.keys()].sort()).toEqual(['OS/2', 'hdmx', 'head', 'hhea', 'maxp', 'name'])
    let sum = 0
    for (let i = 0; i < b.length; i += 4) sum = (sum + b.readUInt32BE(i)) >>> 0
    expect(sum).toBe(0xb1b0afba)
    expect(nameString(t.get('name')!, 1)).toBe('X')
  })
  it('rejects non-fonts', () => {
    expect(() => readSfnt(Buffer.from('not a font at all'))).toThrow(/TrueType/)
  })
})

describe('naming', () => {
  it('recognises raw faces by name and bold flag', () => {
    expect(matchFace(rawFont({ name: 'Futura Condensed' }))).toBe(face('Everywhere', 'Medium'))
    expect(matchFace(rawFont({ name: 'Futura Condensed', bold: true }))).toBe(face('Everywhere', 'Bold'))
    expect(matchFace(rawFont({ name: 'Futura CondensedLight' }))).toBe(face('Everywhere', 'Light'))
    expect(matchFace(rawFont({ name: 'Eurostile LT Cyr Std' }))).toBeUndefined()
  })

  it('every face maps to its alias through font-resolution rule 2 (family/style), with no fallback', () => {
    for (const f of FIGMA_FACES) expect(fontAlias(`${f.family}/${f.style}`), `${f.family}/${f.style}`).toBe(f.aliases[0])
  })

  it('rewrites names, weights and metrics like the spike', () => {
    const c = convertFont(rawFor(face('Everywhere', 'Medium')), face('Everywhere', 'Medium'))
    const t = readSfnt(c.bytes)
    const n = t.get('name')!
    expect([1, 2, 4, 6, 16, 17].map((id) => nameString(n, id))).toEqual(['Everywhere Medium', 'Regular', 'Everywhere Medium', 'Everywhere-Medium', 'Everywhere', 'Medium'])
    expect(nameString(n, 13)).toBe(NAME_NOTE)
    expect(nameString(n, 0)).toBe('(c) Copyright Test Foundry')
    expect(nameString(n, 8)).toBeUndefined() // FFDec strings are dropped
    expect(ttfFullName(c.bytes)).toBe('Everywhere Medium') // what the preview looks up
    const os2 = t.get('OS/2')!
    expect(os2.readUInt16BE(0)).toBe(4)
    expect(os2.readUInt16BE(4)).toBe(500)
    expect(os2.readUInt16BE(62)).toBe(0xc0)
    expect([os2.readInt16BE(68), os2.readInt16BE(70), os2.readInt16BE(72), os2.readUInt16BE(74), os2.readUInt16BE(76)]).toEqual([984, -227, 0, 984, 227])
    expect(t.get('hhea')!.readInt16BE(8)).toBe(0)
    expect(t.get('head')!.length).toBe(54)
    expect(t.get('head')!.readUInt16BE(44)).toBe(0)
    expect(t.has('hdmx')).toBe(false)
    const single = readSfnt(convertFont(rawFor(face('Falmer', 'Regular')), face('Falmer', 'Regular')).bytes).get('name')!
    expect([nameString(single, 1), nameString(single, 4)]).toEqual(['Falmer', 'Falmer'])
  })

  it('installed file names are the ones the preview reads', () => {
    expect(installedFileName(face('Everywhere', 'Light'))).toBe('Inkwell-Everywhere-Light.ttf')
    expect(registryName(face('MageScript', 'Regular'))).toBe('MageScript Regular (TrueType)')
  })
})

const converted = (fsType = 0): ConvertedFont[] => FIGMA_FACES.map((f) => convertFont(rawFor(f, fsType), f))

describe('install and uninstall (temp folder, in-memory registry)', () => {
  it('installs per face, records a manifest, and reverses exactly that', async () => {
    const sys = sysWith()
    await installFonts(converted(), sys)
    const m = (await readManifest(sys.manifestPath))!
    expect(m.fonts.map((f) => `${f.family}/${f.style}`)).toEqual(FIGMA_FACES.map((f) => `${f.family}/${f.style}`))
    for (const f of m.fonts) {
      expect(existsSync(f.file)).toBe(true)
      expect(sys.values.get(f.regName)).toBe(f.file)
      expect(f.file.startsWith(sys.fontsDir)).toBe(true)
    }
    const st = await fontStatus(sys)
    expect(st.installed).toBe(true)
    expect(st.faces.every((f) => f.present)).toBe(true)
    // an unrelated user font in the same folder and key is untouched by uninstall
    await writeFile(join(sys.fontsDir, 'Other.ttf'), 'x')
    sys.values.set('Other (TrueType)', join(sys.fontsDir, 'Other.ttf'))
    expect(await uninstallFonts(sys)).toEqual([])
    expect(existsSync(sys.manifestPath)).toBe(false)
    expect([...sys.values.keys()]).toEqual(['Other (TrueType)'])
    expect(existsSync(join(sys.fontsDir, 'Other.ttf'))).toBe(true)
    expect((await fontStatus(sys)).installed).toBe(false)
  })

  it('refuses to overwrite a font file it did not install, and writes nothing', async () => {
    const sys = sysWith()
    await mkdir(sys.fontsDir, { recursive: true })
    const foreign = join(sys.fontsDir, 'Inkwell-Everywhere-Bold.ttf')
    await writeFile(foreign, 'someone else')
    await expect(installFonts(converted(), sys)).rejects.toMatchObject({ code: 'foreign' })
    expect(await readFile(foreign, 'utf8')).toBe('someone else')
    expect(sys.values.size).toBe(0)
    expect(existsSync(sys.manifestPath)).toBe(false)
  })

  it('refuses when a registry value of the same name exists', async () => {
    const sys = sysWith()
    sys.values.set('Everywhere Light (TrueType)', 'C:\\elsewhere\\Futura.ttf')
    await expect(installFonts(converted(), sys)).rejects.toThrow(/did not install.*Everywhere Light/)
    expect(sys.values.size).toBe(1)
  })

  it('refuses a second install while the manifest lists fonts', async () => {
    const sys = sysWith()
    await installFonts(converted(), sys)
    await expect(installFonts(converted(), sys)).rejects.toMatchObject({ code: 'already-installed' })
  })

  it('rolls back everything when a step fails midway', async () => {
    const sys = sysWith(memRegistry(3))
    await expect(installFonts(converted(), sys)).rejects.toThrow(/Install failed: access denied.*reversed/)
    expect(sys.values.size).toBe(0)
    expect(existsSync(sys.manifestPath)).toBe(false)
    expect(FIGMA_FACES.some((f) => existsSync(join(sys.fontsDir, installedFileName(f))))).toBe(false)
  })

  it('leaves alone a value repointed or a file changed since install', async () => {
    const sys = sysWith()
    await installFonts(converted(), sys)
    const m = (await readManifest(sys.manifestPath))!
    sys.values.set(m.fonts[0]!.regName, 'C:\\other.ttf')
    await writeFile(m.fonts[1]!.file, 'replaced by the user')
    const w = await uninstallFonts(sys)
    expect(w.join('\n')).toMatch(/now points to C:\\other.ttf/)
    expect(w.join('\n')).toMatch(/was changed since/)
    expect(sys.values.get(m.fonts[0]!.regName)).toBe('C:\\other.ttf')
    expect(await readFile(m.fonts[1]!.file, 'utf8')).toBe('replaced by the user')
    expect(existsSync(m.fonts[2]!.file)).toBe(false)
  })

  it('a damaged manifest is never guessed from', async () => {
    const sys = sysWith()
    await mkdir(join(dir, 'Inkwell'), { recursive: true })
    await writeFile(sys.manifestPath, '{"version": 9}')
    await expect(uninstallFonts(sys)).rejects.toThrow(/Unrecognised/)
  })
})

describe('font tool (synthetic archive, injected FFDec)', () => {
  const setup = async (o: { fsType?: number; faces?: readonly FigmaFace[]; bsa?: boolean } = {}) => {
    const bsaPath = join(dir, 'Skyrim - Interface.bsa')
    await writeFile(bsaPath, buildBsa([{ folder: 'interface', name: 'fonts_en.swf', data: Buffer.from('FWS synthetic') }]))
    const sys = sysWith()
    const progress: FontToolProgress[] = []
    const exported: string[] = []
    const tool = createFontTool({
      sys,
      platformOk: true,
      findBsa: async () => (o.bsa === false ? undefined : bsaPath),
      ffdec: () => ({ javaPath: 'java', ffdecDir: join(dir, 'no-ffdec') }),
      exportFonts: async (swf, out) => {
        exported.push((await readFile(swf, 'latin1')))
        await writeFile(join(out, '3_Eurostile.ttf'), rawFont({ name: 'Eurostile LT Cyr Std' }))
        for (const [i, f] of (o.faces ?? FIGMA_FACES).entries()) await writeFile(join(out, `${i}_${f.raw.name}.ttf`), rawFor(f, o.fsType ?? 0))
      },
      onProgress: (p) => progress.push(p)
    })
    return { tool, sys, progress, exported }
  }

  it('installs from the archive, reports progress, refuses twice, removes', async () => {
    const { tool, sys, progress, exported } = await setup()
    const r = await tool.install()
    expect(r).toMatchObject({ ok: true, warnings: [] })
    expect(exported).toEqual(['FWS synthetic'])
    expect(r.status.faces).toHaveLength(FIGMA_FACES.length)
    expect(progress.map((p) => p.step)).toEqual(['game', 'export', 'convert', ...FIGMA_FACES.map(() => 'install')])
    expect(fsTypeOf(await readFile(r.status.faces[0]!.file))).toBe(0)
    expect(await tool.install()).toMatchObject({ ok: false, code: 'already-installed' })
    const rm1 = await tool.remove()
    expect(rm1).toMatchObject({ ok: true, status: { installed: false } })
    expect(sys.values.size).toBe(0)
  })

  it.each([2, 4, 8])('fsType %i forbids installation: nothing installed', async (fs) => {
    const { tool, sys } = await setup({ fsType: fs })
    const r = await tool.install()
    expect(r).toMatchObject({ ok: false, code: 'fstype' })
    expect(!r.ok && r.error).toMatch(/forbid/)
    expect(sys.values.size).toBe(0)
    expect(existsSync(sys.fontsDir)).toBe(false)
  })

  it('fsType bits that do not concern installation (no subsetting) pass', async () => {
    const { tool } = await setup({ fsType: 0x100 })
    expect((await tool.install()).ok).toBe(true)
  })

  it('clear errors: game not found, FFDec missing, Everywhere faces missing, not Windows', async () => {
    expect(await (await setup({ bsa: false })).tool.install()).toMatchObject({ ok: false, code: 'game-not-found' })
    const noEverywhere = await setup({ faces: FIGMA_FACES.filter((f) => f.family !== 'Everywhere') })
    expect(await noEverywhere.tool.install()).toMatchObject({ ok: false, code: 'faces-missing' })
    const sys = sysWith()
    const noFfdec = createFontTool({ sys, platformOk: true, findBsa: async () => join(dir, 'x.bsa'), ffdec: () => ({ javaPath: 'java', ffdecDir: join(dir, 'nope') }) })
    expect(await noFfdec.install()).toMatchObject({ ok: false, code: 'ffdec-missing' })
    const mac = createFontTool({ sys, platformOk: false, findBsa: async () => undefined, ffdec: () => ({ javaPath: 'java', ffdecDir: dir }) })
    expect(await mac.install()).toMatchObject({ ok: false, code: 'not-windows' })
    const some = await setup({ faces: FIGMA_FACES.filter((f) => f.family !== 'Dragon') })
    expect(await some.tool.install()).toMatchObject({ ok: true, warnings: [expect.stringMatching(/Dragon\/Regular/)] })
  })
})
