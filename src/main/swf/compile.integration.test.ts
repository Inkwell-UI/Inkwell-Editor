// Runs only when Java, the user's FFDec and the built wrapper jar exist (yarn build:wrapper), like the wrapper integration test.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { compileSwf } from './compile'
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
        [frame('f', ['s', 't']), rectShape('s'), textNode('t', { extra: { text: { verticalAlign: 'center', align: 'center' } } })],
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
})
