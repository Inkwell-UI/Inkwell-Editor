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

const SEVERITY_COLOR = { error: '#b00020', warning: '#8a5300', info: '#0b5cad' } // >= 4.5:1 on white

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
      <section>
        <h2>{strings.fontsTitle}</h2>
        {s?.fonts?.length ? (
          <table>
            <thead>
              <tr>{Object.values(strings.fontsCols).map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {s.fonts.map((f) => (
                <tr key={`${f.swfName}/${f.nodeId}`}>
                  <td>{f.swfName}</td><td>{f.layerName}</td><td>{f.figmaFont}</td><td>{f.styleName ?? ''}</td>
                  <td>{f.alias ?? strings.unmapped}</td><td>{f.via}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p>{strings.fontsNone}</p>}
      </section>
      <section>
        <h2>{strings.lintTitle}</h2>
        {s?.lint?.length ? (
          <table>
            <thead>
              <tr>{Object.values(strings.lintCols).map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {s.lint.map((l, i) => (
                <tr key={i}>
                  {/* text label plus colour, so colour is never the only cue */}
                  <td style={{ color: SEVERITY_COLOR[l.severity], fontWeight: 600 }}>{l.severity}</td>
                  <td>{l.code}</td><td>{l.message}</td><td>{l.swfName}</td><td>{l.layerName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p>{strings.lintNone}</p>}
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
