import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PreviewBuild } from '../../shared/preview'
import type { SwfReport } from '../../shared/syncState'
import { createStageTimer, type BuildTiming } from '../../shared/timing'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { loadProject, saveProject, type Project } from '../project'
import type { PreviewFontSet } from '../previewFonts'
import { compileSwf } from '../swf/compile'
import type { ChangeResult } from './syncServer'

export interface PipelineConfig {
  /** Open project folder; when set, the IR Figma sent is saved to swfs/<name>/ir.json. */
  projectDir?: string
  /** Output folder (git-ignored): `<buildDir>/<swf name>.swf`. */
  buildDir: string
  javaPath: string
  ffdecDir: string
  jarPath: string
  /** Called after every build with the preview SWF bytes (or the reason there are none). A failed preview never fails the build. */
  onPreview?: (p: Omit<PreviewBuild, 'seq'>) => void
  /** Preview text fonts (see previewFonts.ts); without it the preview uses Ruffle's generic device fonts. */
  previewFonts?: PreviewFontSet
  /** Tests inject a fake FFDec; the install and jar checks are skipped. */
  ffdec?: { build: Parameters<typeof compileSwf>[1]['ffdec']['build']; stop?: () => void }
  onBuild?: (swfPath: string, timing: BuildTiming, lintCount: number, report: SwfReport) => void
}

/** Defaults documented in docs/sync-server.md. */
export const envConfig = (env: NodeJS.ProcessEnv = process.env): Pick<PipelineConfig, 'javaPath' | 'ffdecDir'> => ({
  javaPath: env['INKWELL_JAVA'] ?? 'java',
  ffdecDir: env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
})

/** Rows for the editor window from one compile result. */
export function toReport(swfId: string, name: string, r: Pick<Awaited<ReturnType<typeof compileSwf>>, 'lint' | 'fonts'>): SwfReport {
  return {
    swfId,
    name,
    fonts: r.fonts.map((f) => ({
      swfName: name, nodeId: f.nodeId, layerName: f.nodeName, figmaFont: f.figmaFont,
      ...(f.styleName ? { styleName: f.styleName } : {}), ...(f.alias ? { alias: f.alias } : {}), via: f.via
    })),
    lint: r.lint.map((l) => ({ swfName: name, nodeId: l.nodeId, layerName: l.nodeName ?? l.nodeId, severity: l.severity, code: l.code, message: l.message }))
  }
}

/** The server's default onChange: persist the IR (if a project is open), compile it with the resident FFDec wrapper, return lint as sync issues. */
export function createBuildPipeline(cfg: PipelineConfig) {
  let project: Promise<Project> | undefined
  let ffdec: { build: Parameters<typeof compileSwf>[1]['ffdec']['build']; stop?: () => void } | undefined

  async function onChange(swfId: string, ir: Parameters<typeof compileSwf>[0], name: string): Promise<ChangeResult> {
    // Missing FFDec is a clear error status, not a crash; the server keeps running.
    if (!cfg.ffdec && !existsSync(join(cfg.ffdecDir, 'lib', 'ffdec_lib.jar')))
      throw new Error(`FFDec not found in "${cfg.ffdecDir}". Install it or set INKWELL_FFDEC.`)
    if (!cfg.ffdec && !existsSync(cfg.jarPath)) throw new Error(`FFDec wrapper jar missing (${cfg.jarPath}). Run "yarn build:wrapper".`)
    ffdec ??= cfg.ffdec ?? createFfdecWrapper({ javaPath: cfg.javaPath, ffdecDir: cfg.ffdecDir, jarPath: cfg.jarPath })

    const timer = createStageTimer()
    timer.start('sync')
    let instanceNames: Record<string, string> = {}
    let modId = 'inkwell'
    if (cfg.projectDir) {
      const p = await (project ??= loadProject(cfg.projectDir))
      // folder = swf name; a renamed frame moves its folder (and overlay) along. Swfs whose frame is gone are never removed here.
      const prev = Object.keys(p.swfs).find((k) => k !== name && p.swfs[k]!.ir['id'] === swfId)
      const overlay = (p.swfs[name] ?? (prev ? p.swfs[prev] : undefined))?.overlay ?? {}
      if (prev) delete p.swfs[prev]
      modId = p.meta.modId
      const nodes = (overlay['nodes'] ?? {}) as Record<string, { instanceName?: string }>
      instanceNames = Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : [])))
      // The editor never edits the visual IR: this stores exactly what Figma sent.
      p.swfs[name] = { ir: ir as unknown as Record<string, unknown>, overlay }
      await saveProject(cfg.projectDir, p)
    }
    timer.end('sync')
    const sync = timer.finishBuild()

    const r = await compileSwf(ir, { modId, instanceNames, buildDir: cfg.buildDir, outPath: join(cfg.buildDir, `${name}.swf`), ffdec })
    // Preview SWF: same content with device-font text, built after the game SWF. Its failure is reported to the preview panel only.
    const pt = createStageTimer()
    pt.start('preview-build')
    const preview: Omit<PreviewBuild, 'seq'> = { swfId, name, stage: ir.stage, notes: { textExtensions: 0, textNodes: 0, approximated: [] } }
    try {
      const pr = await compileSwf(ir, { modId, instanceNames, buildDir: join(cfg.buildDir, 'preview'), outPath: join(cfg.buildDir, `${name}.preview.swf`), ffdec, preview: true, ...(cfg.previewFonts ? { previewFont: cfg.previewFonts.nameFor, ...(process.env['INKWELL_PREVIEW_EMBED'] === '0' ? {} : { previewFontBytes: cfg.previewFonts.bytesFor }) } : {}) })
      const buf = await readFile(pr.swfPath)
      preview.bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      preview.notes = { textExtensions: pr.gfxTextExtensions, textNodes: pr.fonts.length, approximated: cfg.previewFonts?.approximated(pr.fonts.flatMap((f) => (f.alias ? [f.alias] : []))) ?? [] }
    } catch (e) {
      preview.error = e instanceof Error ? e.message : String(e)
    }
    pt.end('preview-build')
    const prev = pt.finishBuild()
    const timing: BuildTiming = { stages: { ...sync.stages, ...r.timings.stages, ...prev.stages }, total: sync.total + r.timings.total + prev.total }
    cfg.onBuild?.(r.swfPath, timing, r.lint.length, toReport(swfId, name, r))
    cfg.onPreview?.(preview) // after onBuild, so the window's timing is already the new build's when the renderer answers
    return { issues: r.lint.map((l) => ({ code: l.code, message: l.message, nodeId: l.nodeId, severity: l.severity })) }
  }

  return { onChange, stop: (): void => ffdec?.stop?.() }
}
