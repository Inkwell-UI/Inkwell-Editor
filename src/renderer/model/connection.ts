import type { SnapshotInfo } from '../../shared/projectState'
import type { SyncUiState } from '../../shared/syncState'

export type DotTone = 'ok' | 'warn' | 'error' | 'off'
/** The Figma bridge states of UX 4.1, plus the auth/version errors of 5.4/7 (shown amber for version, red for auth or a dead server). */
export type FigmaStatus = 'synced' | 'patching' | 'mismatch' | 'authError' | 'serverError' | 'snapshot' | 'disconnected' | 'starting'

/** A snapshot the project can work from (a broken file is reported, not used). */
export const usableSnapshot = (s: SnapshotInfo | undefined): boolean => !!s && !s.error

/** `snapshot`: the open project's figma/snapshot.json; disconnected with a usable one is `Disconnected (Using Snapshot)` (UX 4.6). */
export function figmaConnection(s: SyncUiState | undefined, snapshot?: SnapshotInfo): { status: FigmaStatus; tone: DotTone } {
  if (!s || s.server === 'starting') return { status: 'starting', tone: 'off' }
  if (s.server === 'error') return { status: 'serverError', tone: 'error' }
  if (s.connections > 0) return s.build === 'compiling' ? { status: 'patching', tone: 'ok' } : { status: 'synced', tone: 'ok' }
  if (s.connectionIssue?.kind === 'auth') return { status: 'authError', tone: 'error' }
  if (s.connectionIssue?.kind === 'version') return { status: 'mismatch', tone: 'warn' }
  return { status: usableSnapshot(snapshot) ? 'snapshot' : 'disconnected', tone: 'off' }
}
