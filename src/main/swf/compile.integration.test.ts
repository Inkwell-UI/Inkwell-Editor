// Runs only when Java, the user's FFDec and the built wrapper jar exist (yarn build:wrapper), like the wrapper integration test.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { compileSwf } from './compile'
import { syntheticPng } from '../images/synthetic'
import { frame, rectShape, swf, textNode } from './ir.testutil'

const ffdecDir = process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
const javaPath = process.env['INKWELL_JAVA'] ?? 'java'
const jarPath = resolve(__dirname, '../../../tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const hasJava = (() => {
  try {
    execFileSync(javaPath, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const can = hasJava && existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath) && existsSync(join(ffdecDir, 'ffdec-cli.jar'))

describe.skipIf(!can)('compileSwf (real FFDec)', () => {
  it('frame + rectangle + text -> SWF with imported outline font, the shape and the AS2 class', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-swf-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const ir = swf(
        [frame('f', ['s', 't']), rectShape('s'), textNode('t', { verticalAlign: 'center', align: 'center' })],
        { id: 'itest' }
      )
      const r = await compileSwf(ir, { modId: 'ItestMod', buildDir: dir, ffdec })
      expect(r.lint).toEqual([])
      expect(Object.keys(r.timings.stages).sort()).toEqual(['codegen', 'ffdec', 'swf'])

      const xmlPath = join(dir, 'out.xml')
      execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', r.swfPath, xmlPath], { stdio: 'ignore' })
      const xml = readFileSync(xmlPath, 'utf8')
      const edit = /<item type="DefineEditTextTag"[^>]*>/.exec(xml)?.[0] ?? ''
      expect(edit).toMatch(/hasFont="true"/)
      expect(edit).toMatch(/fontId="2"/)
      expect(edit).toMatch(/hasFontClass="false"/)
      expect(edit).toMatch(/useOutlines="true"/)
      expect(edit).toMatch(/wasStatic="false"/)
      expect(xml).toMatch(/<item type="ImportAssets2Tag"[^>]*url="gfxfontlib.swf"/)
      expect(xml).toContain('$EverywhereMediumFont')
      // the shape was filled in by -importShapes (red, from the SVG) and the AS2 class exists
      expect(xml).toMatch(/<item type="DefineShape3Tag"[^>]*shapeId="1"/)
      expect(xml).toMatch(/<color type="RGBA" alpha="255" blue="0" green="0" red="255"\/>/)
      expect(xml).toContain('__Packages.mods.ItestMod.ItestLayout')
      expect(xml).toMatch(/name="rect_s"/)
      expect(xml).toMatch(/name="text_t"/)
    } finally {
      ffdec.stop()
    }
  }, 60_000)

  it('preview: the vertical-align emulation (textHeight, _rotation) compiles with FFDec', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-swf-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const ir = swf([frame('f', ['t']), textNode('t', { verticalAlign: 'center' })], { id: 'valign' })
      const r = await compileSwf(ir, { modId: 'ItestMod', buildDir: dir, ffdec, preview: true })
      expect(r.lint).toEqual([])
    } finally {
      ffdec.stop()
    }
  }, 60_000)

  it('a nested frame with a solid fill and clipContent: the fill and the mask shapes are filled in and the clip layer survives FFDec', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-swf-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const ir = swf([frame('f', ['g']), frame('g', ['s'], { clipContent: true, fills: [{ type: 'solid', color: { r: 0, g: 0, b: 1 } }] }), rectShape('s')], { id: 'frameclip' })
      const r = await compileSwf(ir, { modId: 'ItestMod', buildDir: dir, ffdec })
      expect(r.lint).toEqual([])
      const xmlPath = join(dir, 'out.xml')
      execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', r.swfPath, xmlPath], { stdio: 'ignore' })
      const xml = readFileSync(xmlPath, 'utf8')
      expect(xml).toMatch(/clipDepth="3"/) // mask 1, fill 2, rect 3
      expect(xml).toMatch(/name="fill"/)
      expect(xml).toMatch(/<color type="RGBA" alpha="255" blue="255" green="0" red="0"\/>/) // the frame's fill, drawn
    } finally {
      ffdec.stop()
    }
  }, 60_000)

  it('preview: a rotated text uses an embedded font whose glyphs FFDec imported from the TTF (subset only)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-swf-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const ttf = readFileSync(resolve(__dirname, '../../../resources/preview-fonts/BarlowCondensed-Regular.ttf'))
      const ir = swf([frame('f', ['t']), textNode('t', { content: 'Hi é', transform: { x: 5, y: 6, width: 120, height: 30, rotation: 30 } })], { id: 'itestp' })
      const r = await compileSwf(ir, { modId: 'ItestMod', buildDir: dir, ffdec, preview: true, previewFont: () => 'Barlow Test', previewFontBytes: () => ttf })
      const xmlPath = join(dir, 'out.xml')
      execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', r.swfPath, xmlPath], { stdio: 'ignore' })
      const xml = readFileSync(xmlPath, 'utf8')
      const edit = /<item type="DefineEditTextTag"[^>]*>/.exec(xml)?.[0] ?? ''
      expect(edit).toMatch(/useOutlines="true"/)
      expect(edit).toMatch(/hasFontClass="false"/)
      const font = /<item type="DefineFont3Tag"[\s\S]*?<\/item>\s*(?=<item type="DefineEditTextTag")/.exec(xml)?.[0] ?? ''
      expect(font).toContain('Barlow Test')
      expect(font.match(/<item type="SHAPE"/g)?.length).toBe(96) // printable ASCII + e-acute
    } finally {
      ffdec.stop()
    }
  }, 60_000)

  it('images: the embedded bitmap survives FFDec next to imported shapes and AS2; dds mode compiles the loader class', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-swf-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const img = syntheticPng(64, 64)
      const node = { ...rectShape('i'), name: 'logo', type: 'image', asset: img.hash, scaleMode: 'fit' } as unknown as Parameters<typeof swf>[0][number]
      const ir = swf([frame('f', ['s', 'i', 't']), rectShape('s'), node, textNode('t', { verticalAlign: 'center' })], { id: 'itesti' })
      const images = (h: string) => (h === img.hash ? img.image : undefined)
      const xmlOf = (p: string): string => {
        const x = join(dir, `${Math.random()}.xml`)
        execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', p, x], { stdio: 'ignore' })
        return readFileSync(x, 'utf8')
      }
      const e = await compileSwf(ir, { modId: 'ItestMod', buildDir: dir, ffdec, images })
      expect(e.lint).toEqual([])
      const xml = xmlOf(e.swfPath)
      expect(xml).toMatch(/<item type="DefineBitsLossless2Tag"[^>]*bitmapFormat="5"[^>]*bitmapHeight="64"/)
      expect(xml).toMatch(/fillStyleType="65"/) // clipped bitmap fill (0x41)
      expect(xml).toMatch(/name="logo"/)
      expect(xml).toContain('__Packages.mods.ItestMod.ItestiLayout')

      const d = await compileSwf(ir, { modId: 'ItestMod', buildDir: dir, outPath: join(dir, 'dds.swf'), ffdec, images, imageMode: 'dds' })
      expect(d.ddsImages).toBe(1)
      const dx = xmlOf(d.swfPath)
      expect(dx).not.toContain('DefineBitsLossless2Tag')
      expect(dx).toContain('__Packages.mods.ItestMod.ItestiImages')
      expect(dx).toMatch(/name="logo"/)
    } finally {
      ffdec.stop()
    }
  }, 60_000)
})
