import { isPackageTarget } from '../../shared/deploy'
import type { CommandId } from '../../shared/commands'
import { strings } from '../../shared/strings'
import { inkwell } from '../hooks/api'
import { WORKSPACE_IDS } from '../workspace/workspaces'
import { useDeployStore } from './deployStore'
import { useDialogStore } from './dialogStore'
import { flushGraphSaves } from './graphStore'
import { useProjectStore } from './projectStore'
import { useToastStore } from './toastStore'
import { useWorkspaceStore } from './workspaceStore'

/**
 * What each command of `shared/commands.ts` does. A panel or the shell that owns the state a command needs (the preview's pause and reload, the setup guide) registers it here with
 * `registerCommand`, so no panel imports another; the rest use the stores directly. Called by the palette, the menus (main sends the id) and the `?` key.
 */
const handlers = new Map<CommandId, () => void>()
export function registerCommand(id: CommandId, fn: () => void): () => void {
  handlers.set(id, fn)
  return () => void (handlers.get(id) === fn && handlers.delete(id))
}

const activeSwfName = (): string | undefined => {
  const s = useProjectStore.getState()
  return s.project?.swfs.find((x) => x.id === s.activeSwfId)?.name
}

/** The Deploy menu's first folder target (the one a plain Deploy click would be); nothing set up = a toast. */
async function deployToFolder(): Promise<void> {
  const t = (await inkwell?.getDeployTargets())?.find((x) => !isPackageTarget(x.id) && !x.disabledReason)
  if (!t) return void useToastStore.getState().push({ tone: 'error', title: strings.cmd.noDeployTarget })
  await useDeployStore.getState().start(t.id, activeSwfName())
}

export function runCommand(id: CommandId): void {
  const h = handlers.get(id)
  if (h) return h()
  const dialogs = useDialogStore.getState()
  switch (id) {
    case 'palette': return dialogs.show('palette')
    case 'shortcuts': return dialogs.show('shortcuts')
    case 'settings': return dialogs.show('settings')
    case 'projectSettings': return dialogs.show('projectSettings')
    case 'packages': return dialogs.show('packages')
    case 'save': return flushGraphSaves()
    case 'rebuild': return void inkwell?.buildAll()
    case 'deploy': return void deployToFolder()
    case 'devDeploy': return void inkwell?.devSetDeploy(true).then(deployToFolder)
    case 'package': return void useDeployStore.getState().start('package', activeSwfName())
    case 'workspace1':
    case 'workspace2':
    case 'workspace3': return useWorkspaceStore.getState().setActive(WORKSPACE_IDS[Number(id.slice(-1)) - 1]!)
    default: // setup, playPause, reloadPreview: registered by their owner while it is mounted
  }
}
