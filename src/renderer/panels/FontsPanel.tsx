import { useSyncState } from '../hooks/useSyncState'
import { strings } from '../strings'
import { Panel } from './Panel'

/** How each text layer's font resolved. Data: useSyncState().fonts. */
export function FontsPanel() {
  const fonts = useSyncState()?.fonts
  return (
    <Panel title={strings.fontsTitle}>
      {fonts?.length ? (
        <table>
          <thead>
            <tr>{Object.values(strings.fontsCols).map((c) => <th key={c} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            {fonts.map((f) => (
              <tr key={`${f.swfName}/${f.nodeId}`}>
                <td>{f.swfName}</td><td>{f.layerName}</td><td>{f.figmaFont}</td><td>{f.styleName ?? ''}</td>
                <td>{f.alias ?? strings.unmapped}</td><td>{f.via}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p>{strings.fontsNone}</p>}
    </Panel>
  )
}
