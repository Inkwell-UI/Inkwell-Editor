import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Graph } from '@inkwell-ui/spec'
import type { PreviewBuild } from '../../shared/preview'
import type { SwfReport } from '../../shared/syncState'
import { createStageTimer, type BuildTiming } from '../../shared/timing'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import type { AssetStore, ImageMode } from '../images/assets'
import { loadCodegenPacks, type CodegenPacks } from '../codegen/packs'
import { loadProject, saveProject, type Project } from '../project'
import { bindingsOf } from '../../shared/graphBinding'
import { listSettings, locKeysOf } from '../../shared/overlay'
import { readGraphs } from '../project/graphFiles'
import { exclusive } from '../project/lock'
import { snapshotContent, writeSnapshot, type FigmaSnapshot, type SnapshotSource } from '../project/snapshot'
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
  /** Pack folders whose node templates compile the project's graphs into the SWF (the preview too); none = graphs are not compiled. */
  packDirs?: string[]
  /** Preview text fonts (see previewFonts.ts); without it the preview uses Ruffle's generic device fonts. */
  previewFonts?: PreviewFontSet
  /** Tests inject a fake FFDec; the install and jar checks are skipped. */
  ffdec?: { build: Parameters<typeof compileSwf>[1]['ffdec']['build']; stop?: () => void }
  onBuild?: (swfPath: string, timing: BuildTiming, lintCount: number, report: SwfReport) => void
  /** The project's image assets (assets/<hash>.png); without it every image is linted `image-missing-asset`. */
  assets?: Pick<AssetStore, 'get' | 'has'>
  /** The plugin's last hello (pluginVersion, fileKey) for figma/snapshot.json; undefined keeps the stored one. */
  snapshotSource?: () => SnapshotSource | undefined
  /** True while the project's Dev deploy toggle is on: every custom menu also builds `<name>.dev.swf` (pin/watch hooks, docs/dev-mode.md) next to the game SWF. */
  devBuild?: () => boolean
  /** After a dev SWF was written. */
  onDevBuild?: (name: string) => void
  /** After figma/snapshot.json was checked (written only when its content changed). */
  onSnapshot?: (s: FigmaSnapshot) => void
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
  let codegenPacks: ReturnType<typeof loadCodegenPacks> | undefined
  let ffdec: { build: Parameters<typeof compileSwf>[1]['ffdec']['build']; stop?: () => void } | undefined

  /** The resident wrapper (created on first use; shared with Deploy). A missing FFDec is a clear error status, not a crash; the server keeps running. */
  function getFfdec(): NonNullable<typeof ffdec> {
    if (!cfg.ffdec && !existsSync(join(cfg.ffdecDir, 'lib', 'ffdec_lib.jar'))) throw new Error(`FFDec not found in "${cfg.ffdecDir}". Install it or set INKWELL_FFDEC.`)
    if (!cfg.ffdec && !existsSync(cfg.jarPath)) throw new Error(`FFDec wrapper jar missing (${cfg.jarPath}). Run "yarn build:wrapper".`)
    return (ffdec ??= cfg.ffdec ?? createFfdecWrapper({ javaPath: cfg.javaPath, ffdecDir: cfg.ffdecDir, jarPath: cfg.jarPath }))
  }

  async function onChange(swfId: string, ir: Parameters<typeof compileSwf>[0], name: string): Promise<ChangeResult> {
    const ffdec = getFfdec()

    const timer = createStageTimer()
    timer.start('sync')
    let instanceNames: Record<string, string> = {}
    let bindings: Record<string, string> = {}
    let roles: Record<string, string> = {}
    let lists: Record<string, { itemTemplate?: string; spacing?: number }> = {}
    let locKeys: Record<string, string> = {}
    let modId = 'inkwell'
    let imageMode: ImageMode = 'embedded'
    let snapshotError: string | undefined
    if (cfg.projectDir) {
      const dir = cfg.projectDir
      // Exclusive with overlay saves from the editor UI, and the overlay is re-read from disk (the UI may have saved since the project was cached).
      await exclusive(async () => {
        const p = await (project ??= loadProject(dir))
        // folder = swf name; a renamed frame moves its folder (and overlay) along. Swfs whose frame is gone are never removed here.
        const prev = Object.keys(p.swfs).find((k) => k !== name && p.swfs[k]!.ir['id'] === swfId)
        let overlay = (p.swfs[name] ?? (prev ? p.swfs[prev] : undefined))?.overlay ?? {}
        const onDisk = await readFile(join(dir, 'swfs', prev ?? name, 'overlay.json'), 'utf8').then((t) => JSON.parse(t) as unknown, () => undefined)
        if (onDisk && typeof onDisk === 'object' && !Array.isArray(onDisk)) overlay = onDisk as Record<string, unknown>
        if (prev) delete p.swfs[prev]
        modId = p.meta.modId
        imageMode = p.meta.imageMode ?? 'embedded'
        const nodes = (overlay['nodes'] ?? {}) as Record<string, { instanceName?: string; dataBinding?: unknown; role?: unknown; locKey?: unknown; list?: { itemTemplate?: unknown; spacing?: unknown } }>
        bindings = bindingsOf(nodes)
        roles = Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (typeof o.role === 'string' && o.role ? [[id, o.role]] : [])))
        instanceNames = Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : [])))
        lists = listSettings(nodes)
        locKeys = locKeysOf(nodes)
        // The editor never edits the visual IR: this stores exactly what Figma sent.
        p.swfs[name] = { ir: ir as unknown as Record<string, unknown>, overlay }
        // graphs and menu.json are saved by the editor; the cached copy here may be stale, so a build never writes them back
        await saveProject(dir, { ...p, swfs: Object.fromEntries(Object.entries(p.swfs).map(([n, { graphs: _g, menu: _m, menuError: _e, ...rest }]) => [n, rest])) })
        // figma/snapshot.json follows ir.json in the same lock; a failure is reported, the build goes on (ir.json is already saved)
        try {
          const irs = Object.fromEntries(Object.entries(p.swfs).map(([n, s]) => [n, s.ir as unknown as Parameters<typeof compileSwf>[0]]))
          const r = await writeSnapshot(dir, snapshotContent(irs, (h) => cfg.assets?.has(h) ?? false, cfg.snapshotSource?.()))
          cfg.onSnapshot?.(r.snapshot)
        } catch (e) {
          snapshotError = e instanceof Error ? e.message : String(e)
        }
      })
    }
    timer.end('sync')
    const sync = timer.finishBuild()

    // graphs of this SWF as last saved (the renderer saves them; Phase 6 rebuilds on save)
    let graphs: { graphs: Graph[]; packs: CodegenPacks } | undefined
    if (cfg.projectDir && cfg.packDirs?.length) {
      const gs = (await readGraphs(cfg.projectDir, name)).graphs
      if (gs.length) graphs = { graphs: gs, packs: (await (codegenPacks ??= loadCodegenPacks(cfg.packDirs))).packs }
    }
    const images = cfg.assets ? (h: string) => cfg.assets!.get(h) : undefined
    const r = await compileSwf(ir, { modId, instanceNames, roles, lists, ...(Object.keys(locKeys).length ? { locKeys } : {}), ...(graphs ? { graphs, bindings } : {}), buildDir: cfg.buildDir, outPath: join(cfg.buildDir, `${name}.swf`), ffdec, imageMode, ...(images ? { images } : {}), ...(cfg.previewFonts ? { glyphs: cfg.previewFonts.glyphsFor } : {}) })
    // Dev SWF (Dev deploy only): the game SWF plus the hooks that stream pin and variable values to the editor. Never part of the normal build or Package Mod.
    const dt = createStageTimer()
    let devBuilt = false
    if (cfg.devBuild?.() && ir.target.kind === 'customMenu') {
      devBuilt = true
      dt.start('dev-build')
      await compileSwf(ir, { modId, instanceNames, roles, lists, ...(Object.keys(locKeys).length ? { locKeys } : {}), ...(graphs ? { graphs, bindings } : {}), buildDir: join(cfg.buildDir, 'dev'), outPath: join(cfg.buildDir, `${name}.dev.swf`), ffdec, imageMode, dev: true, ...(images ? { images } : {}), ...(cfg.previewFonts ? { glyphs: cfg.previewFonts.glyphsFor } : {}) })
      dt.end('dev-build')
      cfg.onDevBuild?.(name)
    }
    const dev: BuildTiming = devBuilt ? dt.finishBuild() : { stages: {}, total: 0 }
    // Preview SWF: same content with device-font text, built after the game SWF. Its failure is reported to the preview panel only.
    const pt = createStageTimer()
    pt.start('preview-build')
    const preview: Omit<PreviewBuild, 'seq'> = { swfId, name, stage: ir.stage, notes: { textExtensions: 0, textNodes: 0, approximated: [] } }
    try {
      const pr = await compileSwf(ir, { modId, instanceNames, roles, lists, ...(Object.keys(locKeys).length ? { locKeys } : {}), ...(graphs ? { graphs, bindings } : {}), buildDir: join(cfg.buildDir, 'preview'), outPath: join(cfg.buildDir, `${name}.preview.swf`), ffdec, preview: true, ...(images ? { images } : {}), ...(cfg.previewFonts ? { previewFont: cfg.previewFonts.nameFor, ...(process.env['INKWELL_PREVIEW_EMBED'] === '0' ? {} : { previewFontBytes: cfg.previewFonts.bytesFor }) } : {}) })
      const buf = await readFile(pr.swfPath)
      preview.bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      preview.notes = {
        textExtensions: pr.gfxTextExtensions, textNodes: pr.fonts.length, approximated: cfg.previewFonts?.approximated(pr.fonts.flatMap((f) => (f.alias ? [f.alias] : []))) ?? [],
        ...(r.ddsImages ? { ddsImages: r.ddsImages } : {}) // the preview embeds what the game SWF loads from DDS
      }
    } catch (e) {
      preview.error = e instanceof Error ? e.message : String(e)
    }
    pt.end('preview-build')
    const prev = pt.finishBuild()
    const timing: BuildTiming = { stages: { ...sync.stages, ...r.timings.stages, ...dev.stages, ...prev.stages }, total: sync.total + r.timings.total + dev.total + prev.total }
    cfg.onBuild?.(r.swfPath, timing, r.lint.length, toReport(swfId, name, r))
    cfg.onPreview?.(preview) // after onBuild, so the window's timing is already the new build's when the renderer answers
    return {
      issues: [
        ...r.lint.map((l) => ({ code: l.code, message: l.message, nodeId: l.nodeId, severity: l.severity })),
        ...(snapshotError ? [{ code: 'snapshot-write-failed', severity: 'warning', message: `figma/snapshot.json was not updated: ${snapshotError}` }] : [])
      ]
    }
  }

  return { onChange, getFfdec, stop: (): void => ffdec?.stop?.() }
}
