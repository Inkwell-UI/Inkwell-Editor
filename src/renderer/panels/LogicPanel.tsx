import { Plus } from 'lucide-react'
import { FunctionRows, GraphsList, graphNames, useFunctionIds } from '../graph/GraphsList'
import { useGraphActions } from '../graph/useGraphActions'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { useActiveSwf } from '../hooks/useProject'
import { InspFold } from '../ui/InspParts'
import { ComponentsSection } from './ComponentsSection'
import { Panel } from './Panel'

/**
 * Behaviour, left column under the layers: everything the author wrote, in one place. Graphs, Functions and Components each open a graph in the Graph panel. The open graph's
 * variables are a strip of chips in the Graph panel (`graph/VariableStrip.tsx`); the node packs live in the Library tab of the bottom dock.
 */
export function LogicPanel() {
  const actions = useGraphActions()
  const swf = useActiveSwf()
  const fnIds = useFunctionIds()
  return (
    <Panel title={strings.logic.title}>
      <div className="nav logic-nav">
        <GraphsList />
        <InspFold
          id="logic-functions"
          title={`${strings.logic.functions} (${fnIds.length})`}
          summary={graphNames(swf?.id, fnIds)}
          actions={<Btn icon={Plus} variant="quiet" label={strings.lib.newFunction} reason={actions.canAdd} onClick={() => void actions.addFn()} testId="function-add" />}
        >
          <FunctionRows actions={actions} />
        </InspFold>
        <ComponentsSection />
      </div>
    </Panel>
  )
}
