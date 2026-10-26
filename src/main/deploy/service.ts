import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { isPackageTarget, type DeployResult, type DeployScope, type DeployState, type DeployTargetId, type DeployTargetInfo, type GateResult, type PrepareResult } from '../../shared/deploy'
import type { ResolvedSettings, StoredSettings } from '../../shared/doctor'
import { loadCodegenPacks } from '../codegen/packs'
import { findSkyrim } from '../doctor/skyrim'
import { corePackDir } from '../packs'
import { exportGate } from '../lint/gate'
import { loadVanillaHashes, vanillaCacheRoot } from '../vanilla/cache'
import { isConfirmed, isGameData, packageDir, packageFileName, resolveTarget, targetList, withConfirmed } from './plan'
import { commitDeploy, prepareDeploy, type DeployInput, type DeploySwf, type Prepared } from './run'
import { writeAtomic } from './write'
import { writeZip } from './zip'

export interface DeployDeps {
  userData: string
  appPath: string
  /** The open project, or undefined. */
  project(): ({ dir: string; name: string; version: string; modId: string; deploy?: { preset: string; path: string }; swfs: DeploySwf[]; strictMode?: boolean } & Pick<DeployInput, 'imageMode' | 'assets' | 'localization'>) | undefined
  settings(): { stored: StoredSettings; resolved: ResolvedSettings }
  saveStored(s: StoredSettings): Promise<void>
  /** The resident FFDec wrapper (throws with a clear message when FFDec is missing). */
  ffdec(): DeployInput['ffdec']
  report(s: DeployState): void
  /** Package targets: the native save dialog, starting at `defaultPath`; undefined = cancelled. */
  chooseZip?(defaultPath: string): Promise<string | undefined>
  /** The project's Dev deploy toggle with its token and port (docs/dev-mode.md); undefined = off. Asked for folder targets only: a package or Vortex zip never gets dev mode. */
  dev?(): { token: string; port: number } | undefined
  /** Builds the custom menus that have no finished build yet (for a Dev deploy: no current `build/<name>.dev.swf`), so a deploy never stops at "not built". */
  ensureBuilds?(dev: boolean): Promise<void>
}

/** Deploy in two steps so the UI can ask before anything is written: `prepare` compiles and checks everything, `commit` writes. One prepared deploy is pending at a time. */
export function createDeployService(d: DeployDeps) {
  let pending: { token: string; id: DeployTargetId; input: DeployInput; prepared: Prepared; dir: string; zipName: string; scope: DeployScope; gate: GateResult } | undefined

  const targets = (): DeployTargetInfo[] => {
    const p = d.project()
    if (!p) return []
    const { stored, resolved } = d.settings()
    return targetList(resolved, p, (root) => isConfirmed(stored, p.dir, root))
  }

  async function prepare(id: DeployTargetId, scope: DeployScope, activeName?: string): Promise<PrepareResult> {
    pending = undefined
    const p = d.project()
    if (!p) return { ok: false, error: 'No project is open.' }
    const { stored, resolved } = d.settings()
    const t = resolveTarget(id, resolved, p)
    if ('error' in t) return { ok: false, error: t.error }
    if (scope === 'active' && !activeName) return { ok: false, error: 'No SWF is selected.' }
    const pkg = isPackageTarget(id)
    const dev = pkg ? undefined : d.dev?.()
    d.report({ state: 'preparing', message: pkg ? 'Compiling for the package...' : dev ? 'Compiling for Dev deploy...' : 'Compiling for deploy...' })
    try {
      await d.ensureBuilds?.(!!dev)
      const gameDirs = (await findSkyrim({ ...(resolved.skyrimPath ? { manual: resolved.skyrimPath } : {}) })).map((c) => c.path)
      const input: DeployInput = {
        modId: p.modId, modName: p.name, swfs: p.swfs, root: t.root, gameDirs, ...(p.imageMode ? { imageMode: p.imageMode } : {}), ...(p.assets ? { assets: p.assets } : {}), ...(p.localization ? { localization: p.localization } : {}), ...(scope === 'active' && activeName ? { only: activeName } : {}),
        buildDir: join(p.dir, 'build'), ffdec: d.ffdec(), ...(resolved.papyrusExe ? { papyrusExe: resolved.papyrusExe } : {}),
        ...(dev ? { dev } : {}), ...(pkg ? { package: true } : {}), stubsDir: join(d.appPath, 'resources/papyrus-stubs'), packs: (await loadCodegenPacks([corePackDir(d.appPath)])).packs, vanillaHashes: await loadVanillaHashes(vanillaCacheRoot(d.userData))
      }
      const r = await prepareDeploy(input)
      if (!r.ok) {
        d.report({ state: 'error', message: r.error })
        return r
      }
      const token = randomUUID()
      const gate = exportGate(r.prepared.issues, p.strictMode === true)
      pending = { token, id, input, prepared: r.prepared, dir: p.dir, zipName: packageFileName(p.name, p.version), scope, gate }
      const timing = { stages: r.prepared.stages, total: Object.values(r.prepared.stages).reduce((a, b) => a + b, 0) }
      d.report(gate.ok ? { state: 'preparing', message: pkg ? 'Ready to package' : 'Ready to deploy', timing } : { state: 'error', message: blockedMessage(gate, pkg), timing })
      return {
        ok: true, token, root: t.root, files: r.prepared.info, removed: pkg ? [] : r.prepared.removed, gate, lint: r.prepared.lint, notes: r.prepared.plan.notes,
        // a blocked deploy always shows the dialog with the reasons; a package asks through the save dialog instead
        needsConfirm: !gate.ok || (!pkg && !isConfirmed(stored, p.dir, t.root))
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      d.report({ state: 'error', message: error })
      return { ok: false, error }
    }
  }

  async function commit(token: string): Promise<DeployResult> {
    const c = pending
    if (!c || c.token !== token) return { ok: false, error: 'The prepared deploy is no longer valid; start the deploy again.' }
    pending = undefined
    if (!c.gate.ok) { // never trust the renderer: a blocked deploy writes nothing
      const error = blockedMessage(c.gate, isPackageTarget(c.id))
      d.report({ state: 'error', message: error })
      return { ok: false, root: c.input.root, error }
    }
    if (isPackageTarget(c.id)) return writePackage(c)
    d.report({ state: 'writing', message: `Writing ${c.prepared.files.size} files...` })
    const r = await commitDeploy(c.input, c.prepared)
    if (r.ok) {
      await d.saveStored(withConfirmed(d.settings().stored, c.dir, c.input.root)).catch(() => undefined) // the deploy succeeded; failing to remember it only asks again
      d.report({
        state: 'done', ...(r.timing ? { timing: r.timing } : {}),
        message: `${r.devMenus ? 'Dev deployed' : 'Deployed'} ${r.written} file(s)${r.unchanged ? `, ${r.unchanged} unchanged` : ''}${r.removed?.length ? `, ${r.removed.length} removed` : ''} to ${c.input.root}`
      })
    } else d.report({ state: 'error', message: r.error ?? 'Deploy failed.' })
    return r
  }

  /** The same files as a deploy, as one zip with the mod layout at its root (what MO2 "Install mod from archive" and Vortex expect). */
  async function writePackage(c: NonNullable<typeof pending>): Promise<DeployResult> {
    const t0 = performance.now()
    let out: string | undefined
    try {
      out = await d.chooseZip?.(join(packageDir(c.dir), c.zipName))
      if (!out) {
        d.report({ state: 'done', message: 'Package cancelled; nothing was written.' })
        return { ok: false, cancelled: true }
      }
      if (!/\.zip$/i.test(out)) out += '.zip'
      if (!isAbsolute(out)) throw new Error(`"${out}" is not an absolute path.`)
      if (isGameData(dirname(out), c.input.gameDirs)) throw new Error(`Refusing to save the package into the game's Data folder (${dirname(out)}). Save it anywhere else and install it with MO2 or Vortex.`)
      d.report({ state: 'writing', message: `Writing ${c.prepared.files.size} files to ${out}...` })
      await writeAtomic(out, writeZip([...c.prepared.files].map(([name, f]) => ({ name, data: f.data }))))
      const stages = { ...c.prepared.stages, write: performance.now() - t0 }
      const timing = { stages, total: Object.values(stages).reduce((a, b) => a + b, 0) }
      d.report({ state: 'done', timing, message: `Packaged ${c.prepared.files.size} file(s) to ${out}` })
      return { ok: true, root: dirname(out), zipPath: out, written: c.prepared.files.size, unchanged: 0, timing }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      d.report({ state: 'error', message: error })
      return { ok: false, ...(out ? { root: dirname(out) } : {}), error }
    }
  }

  return { targets, prepare, commit, cancel: (): void => void (pending = undefined) }
}

/** The status bar line of a blocked deploy: the count, and the FIRST problem in words (the dialog and the Lint dock list the rest). */
const blockedMessage = (g: GateResult, pkg = false): string => {
  const first = g.blocking[0]
  const what = first ? ` First: ${first.swf ? `${first.swf}: ` : ''}${first.message.length > 220 ? `${first.message.slice(0, 217)}...` : first.message}` : ''
  return `${pkg ? 'Package' : 'Deploy'} blocked: ${g.blocking.length} lint error(s)${g.strict ? ' (Strict Mode promotes warnings)' : ''}.${what}${g.blocking.length > 1 ? ` (+${g.blocking.length - 1} more: ${g.blocking.slice(1, 4).map((l) => l.code).join(', ')}${g.blocking.length > 4 ? ', ...' : ''})` : ''}`
}
