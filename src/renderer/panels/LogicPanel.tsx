import { Package, Plus } from 'lucide-react'
import { FunctionRows, graphNames, useFunctionIds } from '../graph/GraphsList'
import { useGraphActions } from '../graph/useGraphActions'
import { strings } from '../../shared/strings'
import { Btn } from '../ui/Btn'
import { useActiveSwf } from '../hooks/useProject'
import { usePackLock } from '../packs/PacksSection'
import { useDialogStore } from '../state/dialogStore'
import { InspFold } from '../ui/InspParts'
import { ComponentsSection } from './ComponentsSection'
import { PackFunctionGroups, usePackGroups } from './PackFunctions'
import { Panel } from './Panel'

/**
 * Behaviour, left column under the layers: the Library, everything the author can call or create (panel id `logic`, kept so saved layouts still fit). Functions (the project's, then each pack that has
 * some, yours first: move a function into a local pack from its menu or by dropping it on the pack) and Components. A function or component opens its graph in the Graph panel; a layer's graph is
 * opened by selecting the layer. The packs themselves (add, update, remove, export) are the pack manager's (View > Package Manager, or the button here).
 */
export function LogicPanel() {
  const actions = useGraphActions()
  const swf = useActiveSwf()
  const fnIds = useFunctionIds()
  const groups = usePackGroups()
  const { state } = usePackLock()
  const missing = state.locked.filter((p) => p.state !== 'ok').length // in packs.lock but not loaded
  const packFns = groups.reduce((n, p) => n + p.functions.length, 0)
  return (
    <Panel title={strings.logic.title} actions={<Btn icon={Package} variant="quiet" label={strings.packMgr.openTip} onClick={() => useDialogStore.getState().show('packages')} testId="library-manage">{strings.packMgr.open}</Btn>}>
      <div className="nav logic-nav">
        {missing > 0 && <p className="tone-warn" role="status" data-testid="library-missing">{strings.packMgr.missingPacks(missing)}</p>}
        <InspFold
          id="logic-functions"
          title={`${strings.logic.functions} (${fnIds.length + packFns})`}
          summary={graphNames(swf?.id, fnIds)}
          actions={<Btn icon={Plus} variant="quiet" label={strings.lib.newFunction} reason={actions.canAdd} onClick={() => void actions.addFn()} testId="function-add" />}
        >
          <FunctionRows actions={actions} />
          <PackFunctionGroups />
        </InspFold>
        <ComponentsSection />
      </div>
    </Panel>
  )
}
