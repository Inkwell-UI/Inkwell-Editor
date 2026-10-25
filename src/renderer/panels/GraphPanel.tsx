import { useState } from 'react'
import { SplitSquareHorizontal } from 'lucide-react'
import { useActiveSwf } from '../hooks/useProject'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/**
 * Zone 4: the Knotwork graph and the source-mapped AS2 view (UX 4.4). Visual scripting arrives in 0.2, so for now this is the graph
 * header (breadcrumb, disabled tools) and the empty states. The AS2 split toggle works.
 */
export function GraphPanel() {
  const swf = useActiveSwf()
  const component = useSelectionStore((s) => s.component)
  const node = component ? swf?.ir.nodes[component]?.name : undefined
  const [split, setSplit] = useState(false)
  return (
    <Panel
      title={strings.graph.title}
      actions={
        <>
          <Btn label={strings.graph.tidy} reason={strings.graph.laterReason}>{strings.graph.tidy}</Btn>
          <Btn icon={SplitSquareHorizontal} pressed={split} onClick={() => setSplit(!split)} label={strings.graph.as2Split} testId="as2-split">{strings.graph.as2Split}</Btn>
        </>
      }
    >
      <div className="graph">
        <p className="breadcrumb">{strings.graph.breadcrumb(swf?.name, node)}</p>
        <div className={`graph-body${split ? ' is-split' : ''}`}>
          <div className="graph-canvas">
            <p className="empty">{strings.graph.empty}</p>
            <p className="dim">{strings.graph.later}</p>
          </div>
          {split && (
            <div className="as2-view" role="region" aria-label={strings.graph.as2Title}>
              <h3>{strings.graph.as2Title}</h3>
              <p className="empty">{strings.graph.as2Empty}</p>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}
