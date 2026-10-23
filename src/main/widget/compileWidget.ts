import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Swf } from '@inkwell-ui/spec'
import { createStageTimer, type BuildTiming } from '../../shared/timing'
import { compileSwf, type CompileOptions } from '../swf/compile'
import { ident } from '../swf/generate'
import type { LintIssue } from '../swf/lint'
import { buildEsp } from './esp'
import { widgetPlacement } from './frame'
import { generateScripts, instanceScriptName, widgetScriptName } from './papyrus'
import { compilePapyrus } from './papyrusCompiler'

export interface WidgetOptions extends Pick<CompileOptions, 'modId' | 'buildDir' | 'ffdec'> {
  /** Name of the widget (SWF file, script and quest names); default is the SWF id capitalised (`hud` -> `Hud`). */
  widgetName?: string
  /** The user's russo `papyrus.exe`. Without it the .psc and the plugin are still produced, but no .pex (lint warning `papyrus-skipped`). */
  papyrusExe?: string
}

export interface WidgetResult {
  /** Mod-folder-relative path (forward slashes) -> bytes. */
  files: Record<string, Buffer>
  lint: LintIssue[]
  timings: BuildTiming
}

/** HUD widget output: SWF + generated Papyrus (+ compiled .pex) + plugin, as a mod folder in memory (`writeModFolder` writes it out). */
export async function compileWidget(ir: Swf, opts: WidgetOptions): Promise<WidgetResult> {
  if (ir.target.kind !== 'hudWidget') throw new Error(`compileWidget needs a hudWidget target, got "${ir.target.kind}".`)
  const placement = widgetPlacement(ir)
  if (!placement) throw new Error('The root node is missing or not a frame; there is no widget to compile.')
  const widgetName = opts.widgetName ?? ident(ir.id).replace(/^_?([a-z])/, (_, c: string) => c.toUpperCase())
  const timer = createStageTimer()

  const swf = await compileSwf(ir, { ...opts, widget: true, outPath: join(opts.buildDir, `${widgetName}.swf`) })

  timer.start('papyrus')
  const scripts = generateScripts({ modId: opts.modId, widgetName, displayName: ir.name, placement })
  const lint: LintIssue[] = [...swf.lint]
  const files: Record<string, Buffer> = { [`Interface/exported/widgets/${opts.modId}/${widgetName}.swf`]: await readFile(swf.swfPath) }
  for (const s of scripts) files[`Source/Scripts/${s.name}.psc`] = Buffer.from(s.source)
  if (opts.papyrusExe) {
    const r = await compilePapyrus({ papyrusExe: opts.papyrusExe, scripts, workDir: join(opts.buildDir, 'papyrus') })
    lint.push(...r.lint)
    for (const [name, pex] of Object.entries(r.pex)) files[`Scripts/${name}.pex`] = pex
  } else {
    lint.push({ severity: 'warning', code: 'papyrus-skipped', message: 'INKWELL_PAPYRUS is not set; no .pex files were compiled.', nodeId: ir.root })
  }
  timer.end('papyrus')

  timer.start('esp')
  files[`${opts.modId}.esp`] = buildEsp({ questEdid: `${widgetScriptName(opts.modId, widgetName)}Quest`, scriptName: instanceScriptName(opts.modId, widgetName) })
  timer.end('esp')

  const t = timer.finishBuild() // papyrus + esp only; the SWF stages come from compileSwf
  return { files, lint, timings: { stages: { ...swf.timings.stages, ...t.stages }, total: swf.timings.total + t.total } }
}

/** Writes `files` under `outDir` (created as needed). */
export async function writeModFolder(outDir: string, files: Record<string, Buffer>): Promise<void> {
  for (const [rel, data] of Object.entries(files)) {
    const p = join(outDir, ...rel.split('/'))
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, data)
  }
}
