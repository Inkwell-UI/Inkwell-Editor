import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Swf } from '@inkwell-ui/spec'
import { createStageTimer, type BuildTiming } from '../../shared/timing'
import type { FfdecJob, FfdecResult } from '../build/ffdecWrapper'
import { generate, ident, type GenerateOptions } from './generate'
import type { LintIssue } from './lint'
import { writeSwf } from './tags'

export interface CompileOptions extends GenerateOptions {
  /** Work folder; this SWF builds in `<buildDir>/<swf id>/`. */
  buildDir: string
  /** Output file; default `<buildDir>/<swf id>.swf`. */
  outPath?: string
  /** The resident FFDec wrapper (or anything with its `build`). */
  ffdec: { build(job: FfdecJob): Promise<FfdecResult> }
}

export interface CompileResult {
  swfPath: string
  /** Errors block export; the SWF is still written so the rest can be previewed. */
  lint: LintIssue[]
  timings: BuildTiming
}

/** Compiles the supported nodes (frames, shapes, text) of an IR into a SWF. Stages: codegen (IR -> tags/SVG/AS2), swf (files), ffdec. */
export async function compileSwf(ir: Swf, opts: CompileOptions): Promise<CompileResult> {
  const timer = createStageTimer()
  const key = ident(ir.id)
  const dir = join(opts.buildDir, key)
  const swfPath = opts.outPath ?? join(opts.buildDir, `${key}.swf`)

  timer.start('codegen')
  const g = generate(ir, opts)
  timer.end('codegen')

  timer.start('swf')
  await rm(dir, { recursive: true, force: true })
  await mkdir(join(dir, 'shapes'), { recursive: true })
  const base = join(dir, 'base.swf')
  await writeFile(base, writeSwf({ widthPx: g.stage.width, heightPx: g.stage.height, tags: g.tags }))
  for (const s of g.shapes) await writeFile(join(dir, 'shapes', `${s.charId}.svg`), s.svg)
  // character id -> node id, for debugging a build folder
  await writeFile(join(dir, 'shapes.json'), JSON.stringify(Object.fromEntries(g.shapes.map((s) => [s.charId, s.nodeId])), null, 2) + '\n')
  for (const f of g.as2) {
    await mkdir(dirname(join(dir, 'as2', f.path)), { recursive: true })
    await writeFile(join(dir, 'as2', f.path), f.source)
  }
  await mkdir(dirname(swfPath), { recursive: true })
  timer.end('swf')

  if (g.shapes.length || g.as2.length) {
    timer.start('ffdec')
    const r = await opts.ffdec.build({
      base,
      ...(g.shapes.length ? { shapes: join(dir, 'shapes') } : {}),
      ...(g.as2.length ? { scripts: join(dir, 'as2') } : {}),
      out: swfPath
    })
    timer.end('ffdec')
    if (!r.ok) throw new Error(`FFDec build failed: ${r.error ?? (r.cancelled ? 'cancelled' : 'unknown error')}`)
  } else {
    await copyFile(base, swfPath) // nothing for FFDec to fill in
  }
  return { swfPath, lint: g.lint, timings: timer.finishBuild() }
}
