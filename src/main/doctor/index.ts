import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BenchmarkResult, BuildCacheResult, CheckId, CheckResult } from '../../shared/doctor'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { buildVanillaCache, vanillaCacheRoot } from '../vanilla/cache'
import { checkFfdec, checkFigma, checkJava, checkMo2, checkPapyrus, checkProjectIgnore, checkSkyrim, checkVanilla, checkWrapper, wrapperJarPath, type DoctorContext, type SkyrimFacts } from './checks'

export type { DoctorContext } from './checks'

const ORDER: CheckId[] = ['java', 'ffdec', 'wrapper', 'papyrus', 'skyrim', 'vanilla', 'mo2', 'projectIgnore', 'figma']
const TITLES: Record<CheckId, string> = { java: 'Java', ffdec: 'FFDec', wrapper: 'FFDec wrapper', papyrus: 'Papyrus compiler', skyrim: 'Skyrim install', vanilla: 'Vanilla SWF cache', projectIgnore: 'Project .gitignore', figma: 'Figma plugin', mo2: 'MO2 deploy folders' }

/** A check that throws is a failed check, never a failed doctor. */
const safe = (id: CheckId, fn: () => Promise<CheckResult>): Promise<CheckResult> =>
  Promise.resolve()
    .then(fn)
    .catch((e: unknown): CheckResult => ({ id, label: TITLES[id], status: 'fail', detail: `The check failed unexpectedly: ${e instanceof Error ? e.message : String(e)}` }))

/** The checks (all, or only `only`), independent and in parallel (vanilla and mo2 wait for the Skyrim lookup they need). Never throws; rows come back in display order. */
export async function runDoctor(ctx: DoctorContext, only?: CheckId[]): Promise<CheckResult[]> {
  const want = (id: CheckId): boolean => !only || only.includes(id)
  const sky: SkyrimFacts = {}
  const skyrim = want('skyrim') || want('vanilla') || want('mo2') ? safe('skyrim', () => checkSkyrim(ctx, sky)) : undefined
  const after = (id: CheckId, fn: () => Promise<CheckResult>): Promise<CheckResult> | undefined => (want(id) ? skyrim!.then(() => safe(id, fn)) : undefined)
  const now = (id: CheckId, fn: () => Promise<CheckResult>): Promise<CheckResult> | undefined => (want(id) ? safe(id, fn) : undefined)
  const jobs = [
    now('java', () => checkJava(ctx)),
    now('ffdec', () => checkFfdec(ctx)),
    now('wrapper', () => checkWrapper(ctx)),
    now('papyrus', () => checkPapyrus(ctx)),
    want('skyrim') ? skyrim : undefined,
    after('vanilla', () => checkVanilla(ctx, sky.bsa)),
    after('mo2', () => checkMo2(ctx, sky.path ? [sky.path] : [])),
    now('projectIgnore', () => checkProjectIgnore(ctx)),
    now('figma', () => checkFigma(ctx))
  ]
  const all = await Promise.all(jobs)
  return ORDER.flatMap((id) => all.find((r) => r?.id === id) ?? [])
}

/** Builds the vanilla cache from the detected archive into `<userData>/vanilla-cache/<archiveHash>/`. */
export async function buildCacheAction(ctx: DoctorContext): Promise<BuildCacheResult> {
  try {
    const sky: SkyrimFacts = {}
    await checkSkyrim(ctx, sky)
    if (!sky.bsa) return { ok: false, error: 'Skyrim - Interface.bsa was not found; fix the Skyrim install check first.' }
    const r = await buildVanillaCache({ bsaPath: sky.bsa, cacheRoot: vanillaCacheRoot(ctx.userData) })
    return { ok: true, entries: r.entries, bytes: r.bytes, path: r.dir }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1]!
const cli = (exe: string, args: string[]): Promise<void> => new Promise((res, rej) => execFile(exe, args, { windowsHide: true }, (e) => (e ? rej(e) : res())))

/** Cold CLI (3 runs of shapes + script import) vs the wrapper's first job (fresh JVM) vs the median of 10 warm jobs, on the test fixture. User-triggered. */
export async function runBenchmark(ctx: DoctorContext): Promise<BenchmarkResult> {
  const fx = join(ctx.appPath, 'tests/fixtures/ffdec')
  const cliExe = join(ctx.settings.ffdecDir, 'ffdec-cli.exe')
  const jarPath = wrapperJarPath(ctx.appPath)
  if (!existsSync(join(fx, 'base.swf'))) return { ok: false, error: `The test fixture is missing (${fx}).` }
  if (!existsSync(jarPath)) return { ok: false, error: 'The wrapper jar is not built (yarn build:wrapper).' }
  if (!existsSync(cliExe)) return { ok: false, error: `ffdec-cli.exe not found in ${ctx.settings.ffdecDir}.` }
  const dir = await mkdtemp(join(tmpdir(), 'inkwell-bench-'))
  const ffdec = createFfdecWrapper({ javaPath: ctx.settings.javaPath, ffdecDir: ctx.settings.ffdecDir, jarPath })
  try {
    const out = join(dir, 'o.swf')
    const cold: number[] = []
    for (let i = 0; i < 3; i++) {
      const t = performance.now()
      await cli(cliExe, ['-importShapes', join(fx, 'base.swf'), join(dir, 'm.swf'), join(fx, 'shapes')])
      await cli(cliExe, ['-importScript', join(dir, 'm.swf'), out, join(fx, 'as2')])
      cold.push(performance.now() - t)
    }
    const job = { base: join(fx, 'base.swf'), shapes: join(fx, 'shapes'), scripts: join(fx, 'as2'), out }
    const t0 = performance.now()
    const first = await ffdec.build(job)
    const firstMs = performance.now() - t0
    if (!first.ok) return { ok: false, error: first.error ?? 'The wrapper job failed.', coldCliMs: median(cold), coldRuns: cold.length }
    const warm: number[] = []
    for (let i = 0; i < 10; i++) {
      const r = await ffdec.build(job)
      if (!r.ok) return { ok: false, error: r.error ?? 'A warm wrapper job failed.' }
      warm.push(r.wallMs)
    }
    return { ok: true, coldCliMs: median(cold), coldRuns: cold.length, firstJobMs: firstMs, warmMedianMs: median(warm), warmRuns: warm.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    ffdec.stop()
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
