import type { SyncUiState } from '../../shared/syncState'

export type DotTone = 'ok' | 'warn' | 'error' | 'off'
/** The Figma bridge states of UX 4.1, plus the auth/version errors of 5.4/7 (shown amber for version, red for auth or a dead server). */
export type FigmaStatus = 'synced' | 'patching' | 'mismatch' | 'authError' | 'serverError' | 'disconnected' | 'starting'

export function figmaConnection(s: SyncUiState | undefined): { status: FigmaStatus; tone: DotTone } {
  if (!s || s.server === 'starting') return { status: 'starting', tone: 'off' }
  if (s.server === 'error') return { status: 'serverError', tone: 'error' }
  if (s.connections > 0) return s.build === 'compiling' ? { status: 'patching', tone: 'ok' } : { status: 'synced', tone: 'ok' }
  if (s.connectionIssue?.kind === 'auth') return { status: 'authError', tone: 'error' }
  if (s.connectionIssue?.kind === 'version') return { status: 'mismatch', tone: 'warn' }
  return { status: 'disconnected', tone: 'off' }
}
