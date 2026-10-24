import type { DeployLintItem, GateResult } from '../../shared/deploy'
import { promoteStrict } from '../../shared/lint'

/**
 * The export gate. `issues` are the lint of the SWFs being exported (the caller scopes them); Strict Mode promotes warnings to errors,
 * info never blocks. Pure: deploy's prepare step shows the result, and its commit step refuses when `ok` is false.
 */
export function exportGate(issues: readonly DeployLintItem[], strict: boolean): GateResult {
  const rows = promoteStrict(issues, strict)
  const blocking = rows.filter((r) => r.severity === 'error')
  return { ok: blocking.length === 0, strict, blocking, warnings: rows.filter((r) => r.severity === 'warning'), info: rows.filter((r) => r.severity === 'info') }
}
