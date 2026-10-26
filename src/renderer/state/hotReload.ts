import { defaultMenuSettings, resolveMenuNames } from '../../shared/menu'
import type { DevReloadResult } from '../../shared/devLink'
import { inkwell } from '../hooks/api'
import { flushGraphSaves } from './graphStore'
import { useDeployStore } from './deployStore'
import { useDevStore } from './devStore'
import { useProjectStore } from './projectStore'

/** The active SWF when it is a custom menu, with the name the game knows its menu by. */
function activeMenu(): { swf: string; menu: string } | undefined {
  const { project, activeSwfId } = useProjectStore.getState()
  const swf = project?.swfs.find((s) => s.id === activeSwfId)
  if (!project || !swf || swf.orphaned || swf.ir.target.kind !== 'customMenu') return undefined
  return { swf: swf.name, menu: resolveMenuNames(project.modId, { swf: swf.name, settings: swf.menu ?? defaultMenuSettings() }).name }
}

/** With Dev deploy on, Hot Reload builds (when needed) and deploys the active menu SWF to the MO2 mod folder, and the deploy reloads the game; with it off it only asks the game to re-read the disk. */
export const hotReloadDeploys = (): boolean => useDevStore.getState().dev.devDeploy && !!activeMenu()

/** `quiet` (the automatic one): no confirmation dialog and no success toast; a folder not confirmed yet or a blocked deploy is skipped, failures still toast. Returns the plain reload's result. */
export async function hotReload(quiet = false): Promise<DevReloadResult | undefined> {
  const m = activeMenu()
  if (hotReloadDeploys() && m) {
    flushGraphSaves() // the graph the user just edited must be on disk before the build reads it
    await useDeployStore.getState().start('mo2Mod', m.swf, 'active', quiet)
    return undefined
  }
  return inkwell?.devReload(m?.menu)
}

const DELAY = 3000
let timer: ReturnType<typeof setTimeout> | undefined
let dirty = false

const enabled = (): boolean => hotReloadDeploys() && useDevStore.getState().dev.phase === 'connected'

function fire(): void {
  clearTimeout(timer)
  if (!dirty) return
  dirty = false
  if (!enabled()) return // the game went away (or Dev deploy was switched off) since the edit
  // let the debounced graph save reach main and start its rebuild; the deploy then waits for that build
  flushGraphSaves()
  setTimeout(() => void hotReload(true), 400)
}

/** A graph changed: Hot Reload once nothing changes for 3 s (only with Dev deploy on and the game connected). */
export function graphEdited(): void {
  if (!enabled()) return
  dirty = true
  clearTimeout(timer)
  timer = setTimeout(fire, DELAY)
}

/** The graph editor lost focus: Hot Reload now if something changed since the last one. */
export const graphEditorBlurred = (): void => fire()
