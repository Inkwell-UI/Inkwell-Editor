import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { DeployResult, DeployScope, DeployState, DeployTargetId, DeployTargetInfo, GateResult, PrepareResult } from '../../shared/deploy'
import type { ResolvedSettings, StoredSettings } from '../../shared/doctor'
import { findSkyrim } from '../doctor/skyrim'
import { exportGate } from '../lint/gate'
import { loadVanillaHashes, vanillaCacheRoot } from '../vanilla/cache'
import { isConfirmed, resolveTarget, targetList, withConfirmed } from './plan'
import { commitDeploy, prepareDeploy, type DeployInput, type DeploySwf, type Prepared } from './run'

export interface DeployDeps {
  userData: string
  appPath: string
  /** The open project, or undefined. */
  project(): ({ dir: string; name: string; modId: string; deploy?: { preset: string; path: string }; swfs: DeploySwf[]; strictMode?: boolean } & Pick<DeployInput, 'imageMode' | 'assets'>) | undefined
  settings(): { stored: StoredSettings; resolved: ResolvedSettings }
  saveStored(s: StoredSettings): Promise<void>
  /** The resident FFDec wrapper (throws with a clear message when FFDec is missing). */
  ffdec(): DeployInput['ffdec']
  report(s: DeployState): void
}

/** Deploy in two steps so the UI can ask before anything is written: `prepare` compiles and checks everything, `commit` writes. One prepared deploy is pending at a time. */
export function createDeployService(d: DeployDeps) {
  let pending: { token: string; input: DeployInput; prepared: Prepared; dir: string; scope: DeployScope; gate: GateResult } | undefined

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
    d.report({ state: 'preparing', message: 'Compiling for deploy...' })
    try {
      const gameDirs = (await findSkyrim({ ...(resolved.skyrimPath ? { manual: resolved.skyrimPath } : {}) })).map((c) => c.path)
      const input: DeployInput = {
        modId: p.modId, swfs: p.swfs, root: t.root, gameDirs, ...(p.imageMode ? { imageMode: p.imageMode } : {}), ...(p.assets ? { assets: p.assets } : {}), ...(scope === 'active' && activeName ? { only: activeName } : {}),
        buildDir: join(p.dir, 'build'), ffdec: d.ffdec(), ...(resolved.papyrusExe ? { papyrusExe: resolved.papyrusExe } : {}),
        stubsDir: join(d.appPath, 'resources/papyrus-stubs'), vanillaHashes: await loadVanillaHashes(vanillaCacheRoot(d.userData))
      }
      const r = await prepareDeploy(input)
      if (!r.ok) {
        d.report({ state: 'error', message: r.error })
        return r
      }
      const token = randomUUID()
      const gate = exportGate(r.prepared.issues, p.strictMode === true)
      pending = { token, input, prepared: r.prepared, dir: p.dir, scope, gate }
      const timing = { stages: r.prepared.stages, total: Object.values(r.prepared.stages).reduce((a, b) => a + b, 0) }
      d.report(gate.ok ? { state: 'preparing', message: 'Ready to deploy', timing } : { state: 'error', message: blockedMessage(gate), timing })
      return {
        ok: true, token, root: t.root, files: r.prepared.info, removed: r.prepared.removed, gate, lint: r.prepared.lint, notes: r.prepared.plan.notes,
        needsConfirm: !gate.ok || !isConfirmed(stored, p.dir, t.root) // a blocked deploy always shows the dialog with the reasons
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
      const error = blockedMessage(c.gate)
      d.report({ state: 'error', message: error })
      return { ok: false, root: c.input.root, error }
    }
    d.report({ state: 'writing', message: `Writing ${c.prepared.files.size} files...` })
    const r = await commitDeploy(c.input, c.prepared)
    if (r.ok) {
      await d.saveStored(withConfirmed(d.settings().stored, c.dir, c.input.root)).catch(() => undefined) // the deploy succeeded; failing to remember it only asks again
      d.report({
        state: 'done', ...(r.timing ? { timing: r.timing } : {}),
        message: `Deployed ${r.written} file(s)${r.unchanged ? `, ${r.unchanged} unchanged` : ''}${r.removed?.length ? `, ${r.removed.length} removed` : ''} to ${c.input.root}`
      })
    } else d.report({ state: 'error', message: r.error ?? 'Deploy failed.' })
    return r
  }

  return { targets, prepare, commit, cancel: (): void => void (pending = undefined) }
}

const blockedMessage = (g: GateResult): string =>
  `Deploy blocked: ${g.blocking.length} lint error(s)${g.strict ? ' (Strict Mode promotes warnings)' : ''}. ${g.blocking.slice(0, 3).map((l) => `${l.swf ? `${l.swf}: ` : ''}${l.code}`).join(', ')}${g.blocking.length > 3 ? ', ...' : ''}`
