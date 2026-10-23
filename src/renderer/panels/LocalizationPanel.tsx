import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/** Zone 6A, tab 2 (UX 4.6). The localization pipeline arrives in 0.4; this is the table scaffold and an honest empty state. */
export function LocalizationPanel() {
  return (
    <Panel title={strings.loc.title}>
      <div className="toolbar">
        <span className="dim mono">{strings.loc.prefix}</span>
        <span className="push-right row-actions">
          {strings.loc.actions.map((a) => <Btn key={a} reason={strings.loc.later}>{a}</Btn>)}
        </span>
      </div>
      <table>
        <thead><tr>{strings.loc.cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody />
      </table>
      <p className="empty">{strings.loc.empty}</p>
    </Panel>
  )
}
