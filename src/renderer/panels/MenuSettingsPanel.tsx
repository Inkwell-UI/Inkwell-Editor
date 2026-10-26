import { useActiveSwf } from '../hooks/useProject'
import { MenuSettingsForm } from '../menu/MenuSettingsForm'
import { strings } from '../strings'
import { Panel } from './Panel'

/** Tab info for the registry: disabled with the reason unless the active SWF's target is a custom menu (UX 2.2: menu-only controls are disabled with a reason on the other targets). */
export function useMenuSettingsTab(): { disabledReason?: string } {
  const kind = useActiveSwf()?.ir.target.kind
  return kind === 'customMenu' || kind === undefined ? {} : { disabledReason: strings.menuCfg.notMenu }
}

/** Left tab group (Layout and Behaviour): the Config Ownership form of the active custom menu (UX 5.1, docs/menus.md). The Target pill opens the same form in a dialog. */
export function MenuSettingsPanel() {
  return (
    <Panel title={strings.menuCfg.title}>
      <MenuSettingsForm />
    </Panel>
  )
}
