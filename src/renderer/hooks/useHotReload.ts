import { useState } from 'react'
import { defaultMenuSettings, resolveMenuNames } from '../../shared/menu'
import { reloadSummary } from '../../shared/devLink'
import { useDeployStore } from '../state/deployStore'
import { useDevStore } from '../state/devStore'
import { hotReload, hotReloadDeploys } from '../state/hotReload'
import { strings } from '../strings'
import { useActiveSwf, useProject } from './useProject'

/** The Hot Reload button's action and state, shared by the Trace panel and the folded dock strip: `reason` is why it is disabled, `text` the last result. */
export function useHotReload(): { trigger(): Promise<void>; reason: string | undefined; text: string | undefined; bad: boolean } {
  const swf = useActiveSwf()
  const project = useProject()
  const dev = useDevStore((s) => s.dev)
  const deploying = useDeployStore((s) => s.busy)
  const [reload, setReload] = useState<{ busy: boolean; text?: string; bad?: boolean }>({ busy: false })
  const connected = dev.phase === 'connected'
  /** The menu of the active SWF as the game knows it (menu JSON `name`), when the SWF is a custom menu. */
  const menuName = swf && project && swf.ir.target.kind === 'customMenu' ? resolveMenuNames(project.modId, { swf: swf.name, settings: swf.menu ?? defaultMenuSettings() }).name : undefined
  // Dev deploy on: the button builds and deploys the active SWF like Deploy > MO2 mod folder (which reloads the game), else it only asks the game to re-read the disk
  const deployAndReload = dev.devDeploy && !!menuName
  const trigger = async (): Promise<void> => {
    if (reload.busy) return
    if (hotReloadDeploys()) return void (await hotReload())
    setReload({ busy: true, text: strings.dev.reloading })
    const r = await hotReload()
    setReload(r ? { busy: false, text: reloadSummary(r), bad: !r.ok } : { busy: false })
  }
  const reason = deployAndReload ? (deploying ? strings.deploy.running : undefined) : !connected ? strings.dev.reloadNeedsGame : reload.busy ? strings.dev.reloading : undefined
  return { trigger, reason, text: reload.text, bad: !!reload.bad }
}
