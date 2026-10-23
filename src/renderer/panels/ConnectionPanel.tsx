import { useSyncState } from '../hooks/useSyncState'
import { strings } from '../strings'
import { Panel } from './Panel'

/** Figma plugin connection: status, port and the session token to paste into the plugin. Data: useSyncState(). */
export function ConnectionPanel() {
  const s = useSyncState()
  const status = !s || s.server === 'starting' ? strings.syncStarting : s.server === 'error' ? `${strings.syncError}: ${s.error ?? ''}` : s.connections > 0 ? strings.syncConnected : strings.syncWaiting
  return (
    <Panel title={strings.panelConnection} collapsible>
      <div>{strings.syncConnection}: {status}</div>
      {s?.port !== undefined && <div>{strings.syncPort}: {s.port}</div>}
      {s?.token && (
        <div>
          {strings.syncToken}: <code>{s.token}</code>{' '}
          <button onClick={() => void navigator.clipboard.writeText(s.token!)}>{strings.syncCopy}</button>
        </div>
      )}
    </Panel>
  )
}
