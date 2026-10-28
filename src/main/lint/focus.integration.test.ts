// W3/W4 compiled by the real FFDec (the generated AS2 must parse): samples/menu-gamepad as the game SWF and the Ruffle preview SWF.
// Skipped without Java, FFDec or the wrapper jar (a warning says so). What it does in game is TEST-IN-GAME-0.5.md, Phase 3 checks.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { corePack } from '../codegen/codegen.testutil'
import { loadCodegenPacks } from '../codegen/packs'
import { loadProject } from '../project'
import { compileSwf } from '../swf/compile'
import { focusOptions } from './focus'

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
if (!can) console.warn(`[focus test] SKIPPED: Java=${hasJava} FFDec=${existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar'))} wrapper jar=${existsSync(jarPath)}`)
const hex = (s: string): string => Buffer.from(s).toString('hex')

describe.skipIf(!can)('samples/menu-gamepad (real FFDec)', () => {
  const run = async (preview: boolean): Promise<string> => {
    const project = await loadProject(resolve(__dirname, '../../../samples/menu-gamepad'))
    const s = project.swfs['menu']!
    const nodes = (s.overlay as { nodes: Record<string, Record<string, unknown>> }).nodes
    const ir = Swf.parse(s.ir)
    const fo = focusOptions(ir, nodes)
    const { packs } = await loadCodegenPacks([corePack])
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-gamepad-'))
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      const r = await compileSwf(ir, {
        modId: project.meta.modId, buildDir: dir, ffdec, ...(preview ? { preview: true } : {}), focus: fo.focus!, prompts: fo.prompts!,
        instanceNames: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (typeof o['instanceName'] === 'string' ? [[id, o['instanceName']]] : []))),
        roles: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (typeof o['role'] === 'string' ? [[id, o['role']]] : []))),
        graphs: { graphs: Object.values(s.graphs ?? {}), packs }
      })
      expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
      const out = join(dir, 'swf.xml')
      execFileSync(javaPath, ['-jar', join(ffdecDir, 'ffdec-cli.jar'), '-swf2xml', r.swfPath, out], { stdio: 'ignore' })
      return readFileSync(out, 'utf8')
    } finally {
      ffdec.stop()
    }
  }

  it('game SWF: the focus graph, the prompts and the glyph clips', async () => {
    const xml = await run(false)
    expect(xml).toContain('__Packages.mods.InkwellMenuGamepad.MenuMenu')
    for (const s of ['disableFocusKeys', 'focusMoves', 'showPrompts', 'Prompts', 'glyph_playstation']) expect(xml).toContain(hex(s))
    expect(xml).toContain('ControllerButtonsInverted') // the game's pad glyph outline font, imported by alias like any text font
    expect(xml).not.toContain(hex('inkwellPad'))
  }, 120_000)

  it('preview SWF: the same plus the pad emulation callback', async () => {
    const xml = await run(true)
    expect(xml).toContain(hex('inkwellPad'))
    expect(xml).toContain(hex('focusMoves'))
  }, 120_000)
})
