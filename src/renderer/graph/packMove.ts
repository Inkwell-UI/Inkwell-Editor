import { inkwell } from '../hooks/api'
import { reloadPacks, useLibraryPacks, type LibraryPack } from '../hooks/usePacks'
import { moveFunctionToPack } from '../state/graphDocs'
import { findGraphStore } from '../state/graphStore'
import { useToastStore } from '../state/toastStore'
import { strings } from '../../shared/strings'

/** The local packs a function of the project can be moved into. */
export const useLocalPacks = (): LibraryPack[] => useLibraryPacks().filter((p) => p.origin === 'library')

/** "Move to <pack>" for a function of the project: the function leaves the SWF and every call of it follows (`moveFunctionToPack`). */
export async function moveToPack(swf: { id: string; name: string }, fnId: string, packId: string): Promise<void> {
  if (!inkwell) return
  const name = findGraphStore(swf.id, fnId)?.getState().name ?? fnId
  const r = await moveFunctionToPack({ swf, fnId, packId }, inkwell)
  reloadPacks()
  useToastStore.getState().push(r.ok ? { tone: 'ok', title: strings.lib.moved(name, packId) } : { tone: 'error', title: strings.lib.moveFailed, text: r.error })
}
