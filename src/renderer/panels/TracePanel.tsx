import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/**
 * Zone 6A, tab 3 (UX 4.6, 5.4). The runtime debug connection arrives with Inkwell Runtime (0.3), so this is the disabled state: the layout
 * of the trace and watch lists, greyed out, with the instruction to start Skyrim in Dev Mode.
 */
export function TracePanel() {
  return (
    <Panel title={strings.trace.title}>
      <div className="toolbar">
        <span className="dim">{strings.trace.game}</span>
        <span className="push-right row-actions">
          <Btn reason={strings.trace.later}>{strings.trace.hotReload}</Btn>
          <Btn reason={strings.trace.later}>{strings.trace.clear}</Btn>
        </span>
      </div>
      <div className="trace is-greyed">
        <section aria-label={strings.trace.live}>
          <h3>{strings.trace.live}</h3>
          <p className="empty">{strings.trace.start}</p>
        </section>
        <section aria-label={strings.trace.watch}>
          <h3>{strings.trace.watch}</h3>
          <table><thead><tr>{strings.trace.watchCols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead><tbody /></table>
        </section>
      </div>
    </Panel>
  )
}
