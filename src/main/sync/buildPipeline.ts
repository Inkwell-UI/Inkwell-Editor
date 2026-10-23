import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createStageTimer, type BuildTiming } from '../../shared/timing'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { loadProject, saveProject, type Project } from '../project'
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
  onBuild?: (swfPath: string, timing: BuildTiming, lintCount: number) => void
}

/** Defaults documented in docs/sync-server.md. */
export const envConfig = (env: NodeJS.ProcessEnv = process.env): Pick<PipelineConfig, 'javaPath' | 'ffdecDir'> => ({
  javaPath: env['INKWELL_JAVA'] ?? 'java',
  ffdecDir: env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
})

/** The server's default onChange: persist the IR (if a project is open), compile it with the resident FFDec wrapper, return lint as sync issues. */
export function createBuildPipeline(cfg: PipelineConfig) {
  let project: Promise<Project> | undefined
  let ffdec: ReturnType<typeof createFfdecWrapper> | undefined

  async function onChange(swfId: string, ir: Parameters<typeof compileSwf>[0], name: string): Promise<ChangeResult> {
    // Missing FFDec is a clear error status, not a crash; the server keeps running.
    if (!existsSync(join(cfg.ffdecDir, 'lib', 'ffdec_lib.jar')))
      throw new Error(`FFDec not found in "${cfg.ffdecDir}". Install it or set INKWELL_FFDEC.`)
    if (!existsSync(cfg.jarPath)) throw new Error(`FFDec wrapper jar missing (${cfg.jarPath}). Run "yarn build:wrapper".`)
    ffdec ??= createFfdecWrapper({ javaPath: cfg.javaPath, ffdecDir: cfg.ffdecDir, jarPath: cfg.jarPath })

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
    const timing: BuildTiming = { stages: { ...sync.stages, ...r.timings.stages }, total: sync.total + r.timings.total }
    cfg.onBuild?.(r.swfPath, timing, r.lint.length)
    return { issues: r.lint.map((l) => ({ code: l.code, message: l.message, nodeId: l.nodeId, severity: l.severity })) }
  }

  return { onChange, stop: (): void => ffdec?.stop() }
}
