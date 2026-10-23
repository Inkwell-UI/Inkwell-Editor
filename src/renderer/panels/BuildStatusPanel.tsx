import { useSyncState } from '../hooks/useSyncState'
import { strings } from '../strings'
import { Panel } from './Panel'

/** Build state, SWF count and lint count. Data: useSyncState(). */
export function BuildStatusPanel() {
  const s = useSyncState()
  return (
    <Panel title={strings.panelBuildStatus} collapsible>
      <div>{strings.syncBuild}: {strings.buildStates[s?.build ?? 'idle']}{s?.buildError ? ` (${s.buildError})` : ''}</div>
      <div>{strings.syncSwfs}: {s?.swfCount ?? 0}{s?.orphanedCount ? ` (${s.orphanedCount} ${strings.syncOrphaned})` : ''}</div>
      <div>{strings.syncLint}: {s?.lintCount ?? 0}</div>
    </Panel>
  )
}
