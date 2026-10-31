import { Plus } from 'lucide-react'
import { FunctionRows, GraphsList } from '../graph/GraphsList'
import { useGraphActions } from '../graph/useGraphActions'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { ComponentsSection } from './ComponentsSection'
import { Panel } from './Panel'
import { VariablesSection } from './VariablesSection'

/**
 * Behaviour, left column under the layers: everything the author wrote, in one place. Graphs, Functions and Components each open a graph in the Graph panel; Variables are
 * those of the graph that is open. The node packs live in the Library tab of the bottom dock.
 */
export function LogicPanel() {
  const actions = useGraphActions()
  return (
    <Panel title={strings.logic.title}>
      <div className="nav logic-nav">
        <GraphsList />
        <section aria-labelledby="logic-functions" data-testid="functions-section">
          <header className="section-title">
            <h3 id="logic-functions">{strings.logic.functions}</h3>
            <Btn icon={Plus} variant="quiet" label={strings.lib.newFunction} reason={actions.canAdd} onClick={() => void actions.addFn()} testId="function-add" />
          </header>
          <FunctionRows actions={actions} />
        </section>
        <ComponentsSection />
        <VariablesSection />
      </div>
    </Panel>
  )
}
