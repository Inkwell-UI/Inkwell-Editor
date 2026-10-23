// Runs only when Java, the user's FFDec and the wrapper jar exist (like the other FFDec tests). The .pex part also needs INKWELL_PAPYRUS.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { loadProject } from '../project'
import { compileWidget, writeModFolder } from './compileWidget'

const ffdecDir = process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
const javaPath = process.env['INKWELL_JAVA'] ?? 'java'
const jarPath = resolve(__dirname, '../../../tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const sample = resolve(__dirname, '../../../samples/hud-widget')
const hasJava = (() => {
  try {
    execFileSync(javaPath, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const can = hasJava && existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath)
const papyrusExe = process.env['INKWELL_PAPYRUS'] && existsSync(process.env['INKWELL_PAPYRUS']) ? process.env['INKWELL_PAPYRUS'] : undefined

describe.skipIf(!can)('compileWidget (samples/hud-widget, real FFDec)', () => {
  it('produces the mod folder layout', async () => {
    const project = await loadProject(sample)
    const ir = Swf.parse(project.swfs['hud']!.ir) // the sample is valid against the spec schema
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-widget-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const r = await compileWidget(ir, { modId: project.meta.modId, widgetName: 'Hud', buildDir: join(dir, 'work'), ffdec, ...(papyrusExe ? { papyrusExe } : {}) })
      expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
      const expected = [
        'Interface/exported/widgets/InkwellWidgetTest/Hud.swf',
        'Source/Scripts/InkwellWidgetTest_Hud.psc',
        'Source/Scripts/InkwellWidgetTest_HudInstance.psc',
        'InkwellWidgetTest.esp',
        ...(papyrusExe ? ['Scripts/InkwellWidgetTest_Hud.pex', 'Scripts/InkwellWidgetTest_HudInstance.pex'] : [])
      ]
      expect(Object.keys(r.files).sort()).toEqual(expected.sort())
      for (const [p, b] of Object.entries(r.files).filter(([p]) => p.endsWith('.pex'))) expect([...b.subarray(0, 4)], p).toEqual([0xfa, 0x57, 0xc0, 0xde])
      expect(Object.keys(r.timings.stages)).toEqual(expect.arrayContaining(['codegen', 'ffdec', 'papyrus', 'esp']))
      const out = join(dir, 'mod')
      await writeModFolder(out, r.files)
      expect(readFileSync(join(out, 'Interface', 'exported', 'widgets', 'InkwellWidgetTest', 'Hud.swf')).subarray(0, 3).toString()).toBe('FWS')
    } finally {
      ffdec.stop()
    }
  })
})
