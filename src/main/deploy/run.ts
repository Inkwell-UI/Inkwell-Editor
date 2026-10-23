import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Swf } from '@inkwell-ui/spec'
import type { DeployFileInfo, DeployLintItem, DeployResult } from '../../shared/deploy'
import { createStageTimer } from '../../shared/timing'
import { isUnmodifiedVanilla } from '../vanilla/cache'
import { compileWidget, type WidgetOptions } from '../widget/compileWidget'
import { planDeploy, type DeployPlan, type SwfLike } from './plan'
import { readManifest, staleFiles, writeDeploy } from './write'

export interface DeploySwf extends SwfLike {
  /** Overlay instance names by node id (they feed the compiler). */
  instanceNames?: Record<string, string>
  ir: Swf
}

export interface DeployInput {
  modId: string
  swfs: DeploySwf[]
  root: string
  /** Game install folders known to the editor; their Data folder is never written. */
  gameDirs: string[]
  /** Only this SWF (name); omitted = every SWF of the project. */
  only?: string
  buildDir: string
  ffdec: WidgetOptions['ffdec']
  papyrusExe?: string
  stubsDir?: string
  /** Hashes of the vanilla SWF cache; empty when it is not built. */
  vanillaHashes: ReadonlySet<string>
}

/** Everything is compiled and checked before the first byte is written. */
export interface Prepared {
  plan: DeployPlan
  files: Map<string, { data: Buffer; swf: string }>
  info: DeployFileInfo[]
  removed: string[]
  lint: DeployLintItem[]
  scope: Set<string>
  stages: Record<string, number>
}

export type PrepareOutcome = { ok: true; prepared: Prepared } | { ok: false; error: string; lint?: DeployLintItem[] }

export async function prepareDeploy(i: DeployInput): Promise<PrepareOutcome> {
  const plan = planDeploy({ modId: i.modId, swfs: i.swfs, root: i.root, gameDirs: i.gameDirs, hasPapyrus: !!i.papyrusExe, ...(i.only ? { only: i.only } : {}) })
  if (plan.errors.length) return { ok: false, error: plan.errors.join(' '), lint: plan.lint }
  const timer = createStageTimer()
  const lint: DeployLintItem[] = [...plan.lint]
  const files = new Map<string, { data: Buffer; swf: string }>()
  const allowed = new Set(plan.files.map((f) => f.rel))
  timer.start('compile')
  try {
    for (const s of i.swfs.filter((x) => !x.orphaned && (!i.only || x.name === i.only))) {
      if (s.kind === 'hudWidget') {
        const r = await compileWidget(s.ir, {
          modId: i.modId, widgetName: plan.widgets[s.name]!, ...(s.instanceNames ? { instanceNames: s.instanceNames } : {}), buildDir: join(i.buildDir, 'deploy', s.name), ffdec: i.ffdec,
          ...(i.papyrusExe ? { papyrusExe: i.papyrusExe } : {}), ...(i.stubsDir ? { stubsDir: i.stubsDir } : {})
        })
        const errs = r.lint.filter((l) => l.severity === 'error')
        for (const l of r.lint) if (l.code !== 'papyrus-skipped') lint.push({ severity: l.severity, code: l.code, message: `${s.name}: ${l.message}` })
        if (errs.length) return { ok: false, error: `"${s.name}" did not compile: ${errs[0]!.message}`, lint }
        for (const [rel, data] of Object.entries(r.files)) {
          if (!allowed.has(rel)) continue // compile output the plan does not list (no compiler: scripts and plugin) is not deployed
          files.set(rel, { data, swf: s.name })
        }
      } else if (s.kind === 'customMenu') {
        const built = join(i.buildDir, `${s.name}.swf`)
        const data = await readFile(built).catch(() => undefined)
        if (!data) return { ok: false, error: `"${s.name}" has no build yet (${built}). Run Build All first.`, lint }
        files.set(`Interface/${s.name}.swf`, { data, swf: s.name })
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), lint }
  } finally {
    timer.end('compile')
  }
  const missing = plan.files.filter((f) => !files.has(f.rel))
  if (missing.length && i.papyrusExe) return { ok: false, error: `The build did not produce: ${missing.map((m) => m.rel).join(', ')}.`, lint }
  timer.start('vanilla')
  const vanilla = [...files].filter(([rel, f]) => rel.toLowerCase().endsWith('.swf') && isUnmodifiedVanilla(f.data, i.vanillaHashes)).map(([rel]) => rel)
  timer.end('vanilla')
  if (vanilla.length) return { ok: false, error: `Refusing to deploy unmodified vanilla files (Bethesda's SWFs are never exported): ${vanilla.join(', ')}.`, lint }
  const scope = new Set(i.swfs.filter((s) => !s.orphaned && (!i.only || s.name === i.only)).map((s) => s.name))
  const removed = staleFiles(await readManifest(i.root), files.keys(), i.only ? scope : undefined)
  const t = timer.finishBuild()
  return {
    ok: true,
    prepared: { plan, files, info: [...files].map(([rel, f]) => ({ rel, size: f.data.length, swf: f.swf })), removed, lint, scope, stages: t.stages }
  }
}

/** Writes the prepared files (atomic per file), retires stale ones, writes the manifest. */
export async function commitDeploy(i: Pick<DeployInput, 'root' | 'modId' | 'only'>, p: Prepared): Promise<DeployResult> {
  const t0 = performance.now()
  try {
    const o = await writeDeploy({ root: i.root, modId: i.modId, files: p.files, ...(i.only ? { scope: p.scope } : {}) })
    const write = performance.now() - t0
    const stages = { ...p.stages, write }
    return {
      ok: true, root: i.root, written: o.written.length, unchanged: o.unchanged.length, removed: o.removed, kept: o.kept,
      timing: { stages, total: Object.values(stages).reduce((a, b) => a + b, 0) }
    }
  } catch (e) {
    return { ok: false, root: i.root, error: e instanceof Error ? e.message : String(e) }
  }
}
