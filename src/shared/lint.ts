export type Severity = 'error' | 'warning' | 'info'
export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

/**
 * Strict Mode (design spec, "Severity levels"): warnings become errors, info stays info. Pure and shared: the sync server uses it for the
 * build gate (status `error`), the Lint dock for the displayed list. The compiler's own lint stays unpromoted.
 */
export function promoteStrict<T extends object>(rows: readonly T[], strict: boolean): T[] {
  return strict ? rows.map((r) => ((r as { severity?: string }).severity === 'warning' ? { ...r, severity: 'error' } : r)) : [...rows]
}
