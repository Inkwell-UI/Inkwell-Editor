import { useActiveSwf } from '../hooks/useProject'
import { strings } from '../strings'
import { Panel } from './Panel'

/** Contracts are only for menu replacements (design spec, "Menus, contracts and SkyUI"). */
export const contractsReason = (kind: string | undefined): string | undefined => (kind === 'menuReplacement' ? undefined : strings.contracts.onlyReplacements)

/** Tab info for the registry: disabled with the exact note unless the active SWF targets a menu replacement. */
export function useContractsTab(): { disabledReason?: string } {
  const kind = useActiveSwf()?.ir.target.kind
  const reason = contractsReason(kind)
  return reason ? { disabledReason: reason } : {}
}

/** Zone 2, tab 2. The contract check itself is build lint (main/lint/contract.ts); this panel only points there. */
export function ContractsPanel() {
  const reason = contractsReason(useActiveSwf()?.ir.target.kind)
  return (
    <Panel title={strings.contracts.title}>
      <p className="empty">{reason ?? strings.contracts.later}</p>
    </Panel>
  )
}
