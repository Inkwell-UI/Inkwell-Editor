import { useSyncState } from '../hooks/useSyncState'
import { strings } from '../strings'
import { Panel } from './Panel'

const SEVERITY_COLOR = { error: '#b00020', warning: '#8a5300', info: '#0b5cad' } // >= 4.5:1 on white

/** Lint issues of the latest builds, errors first. Data: useSyncState().lint. */
export function LintPanel() {
  const lint = useSyncState()?.lint
  return (
    <Panel title={strings.lintTitle}>
      {lint?.length ? (
        <table>
          <thead>
            <tr>{Object.values(strings.lintCols).map((c) => <th key={c} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            {lint.map((l, i) => (
              <tr key={i}>
                {/* text label plus colour, so colour is never the only cue */}
                <td style={{ color: SEVERITY_COLOR[l.severity], fontWeight: 600 }}>{l.severity}</td>
                <td>{l.code}</td><td>{l.message}</td><td>{l.swfName}</td><td>{l.layerName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p>{strings.lintNone}</p>}
    </Panel>
  )
}
