import { GraphsList } from '../graph/GraphsList'
import { strings } from '../strings'
import { Panel } from './Panel'

/** Behaviour, left tab 2: the project's custom functions (`graph/GraphsList.tsx` in its functions flavour). They are not listed in the Navigator. */
export function LibraryPanel() {
  return (
    <Panel title={strings.lib.title}>
      <div className="nav">
        <GraphsList functions />
      </div>
    </Panel>
  )
}
