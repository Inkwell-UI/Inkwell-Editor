import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { SyncUiState } from '../shared/syncState'
import { strings } from './strings'
import { TimingOverlay } from './TimingOverlay'

interface InkwellApi {
  getSync(): Promise<SyncUiState>
  onSync(cb: (s: SyncUiState) => void): () => void
}
const api = (window as unknown as { inkwell?: InkwellApi }).inkwell

function App() {
  const [s, setS] = useState<SyncUiState>()
  useEffect(() => {
    document.title = strings.windowTitle
    void api?.getSync().then(setS)
    return api?.onSync(setS)
  }, [])
  const connection = !s ? strings.syncStarting : s.server === 'error' ? `${strings.syncError}: ${s.error ?? ''}` : s.server === 'starting' ? strings.syncStarting : s.connections > 0 ? strings.syncConnected : strings.syncWaiting
  return (
    <main>
      <h1>{strings.placeholderHeading}</h1>
      <p>{strings.placeholderBody}</p>
      <section>
        <div>{strings.syncConnection}: {connection}</div>
        {s?.port !== undefined && <div>{strings.syncPort}: {s.port}</div>}
        {s?.token && (
          <div>
            {strings.syncToken}: <code>{s.token}</code>{' '}
            <button onClick={() => void navigator.clipboard.writeText(s.token!)}>{strings.syncCopy}</button>
          </div>
        )}
        <div>{strings.syncBuild}: {strings.buildStates[s?.build ?? 'idle']}{s?.buildError ? ` (${s.buildError})` : ''}</div>
        <div>{strings.syncSwfs}: {s?.swfCount ?? 0}{s?.orphanedCount ? ` (${s.orphanedCount} ${strings.syncOrphaned})` : ''}</div>
        <div>{strings.syncLint}: {s?.lintCount ?? 0}</div>
      </section>
      <TimingOverlay build={s?.timing} />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
