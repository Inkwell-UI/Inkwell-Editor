import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/** Zone 6A, tab 4 (UX 4.6). Mock data drives list previews and data bindings (0.2); until then, an empty state with the preset buttons disabled. */
export function MockDataPanel() {
  return (
    <Panel title={strings.mock.title}>
      <div className="toolbar">
        {strings.mock.presets.map((p) => <Btn key={p} reason={strings.mock.later}>{p}</Btn>)}
      </div>
      <p className="empty">{strings.mock.empty}</p>
    </Panel>
  )
}
