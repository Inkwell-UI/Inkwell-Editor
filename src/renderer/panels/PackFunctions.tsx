import { useState, type DragEvent } from 'react'
import { Copy, Lock } from 'lucide-react'
import type { Graph } from '@inkwell-ui/spec'
import { FUNCTION_DRAG, GraphRowView } from '../graph/GraphsList'
import { moveToPack } from '../graph/packMove'
import { inkwell } from '../hooks/api'
import { reloadPacks, useLibraryPacks, type LibraryPack } from '../hooks/usePacks'
import { useActiveSwf } from '../hooks/useProject'
import { copyLibraryFunction, forgetLibraryFunction, openLibraryFunction, renameLibraryFunction, useGraphDocs } from '../state/graphDocs'
import { useToastStore } from '../state/toastStore'
import { strings } from '../../shared/strings'
import { Btn } from '../ui/Btn'

const toast = (t: Parameters<ReturnType<typeof useToastStore.getState>['push']>[0], ms?: number): void => useToastStore.getState().push(t, ms)

/** The packs the Functions section lists: your own local packs (even empty, they take dropped functions) and any pack that has functions. A pack of nodes only is the pack manager's. */
export function usePackGroups(): LibraryPack[] {
  return useLibraryPacks().filter((p) => p.origin === 'library' || p.functions.length > 0)
}

/**
 * Under the project's own functions in the Library panel: one group per pack that has functions (or is yours), a heading with the pack's name and version and its functions as rows. A local pack's
 * functions are editable and take a function dropped on the group (or "Move to <pack>" in a function's menu); the other packs are read-only and offer a copy into the project.
 */
export function PackFunctionGroups() {
  const swf = useActiveSwf()
  const groups = usePackGroups()
  if (!swf) return null
  return <>{groups.map((p) => <PackGroup key={p.id} pack={p} swf={swf} />)}</>
}

function PackGroup({ pack, swf }: { pack: LibraryPack; swf: { id: string; name: string } }) {
  const own = pack.origin === 'library' // a local pack: editable. Imported and installed packs are immutable
  const [over, setOver] = useState(false)
  const activeId = useGraphDocs((s) => s.active[swf.id])
  const accepts = (e: DragEvent): boolean => own && e.dataTransfer.types.includes(FUNCTION_DRAG)
  const drop = (e: DragEvent): void => {
    setOver(false)
    const fnId = e.dataTransfer.getData(FUNCTION_DRAG)
    if (!own || !fnId || fnId.includes('/')) return // a pack's own function is not the project's to move
    e.preventDefault()
    void moveToPack(swf, fnId, pack.id)
  }
  const removeFn = async (fn: Graph): Promise<void> => {
    if (!inkwell) return
    const r = await inkwell.removeLibraryFunction(pack.id, fn.id.slice(pack.id.length + 1))
    if (r.ok) (forgetLibraryFunction(swf, fn.id), reloadPacks())
    else toast({ tone: 'error', title: strings.lib.importFailed, text: r.error })
  }
  const copy = async (fn: Graph): Promise<void> => {
    if (!inkwell) return
    const r = await copyLibraryFunction({ swf, fn }, inkwell)
    if (!r.ok) toast({ tone: 'error', title: strings.lib.exportFailed, text: r.error })
  }
  return (
    <div
      className={`logic-pack${over ? ' is-drop' : ''}`}
      data-testid={`library-pack-${pack.id}`}
      title={own ? strings.lib.dropTip : strings.lib.lockedPack}
      onDragOver={(e) => accepts(e) && (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <div className="logic-pack-head">
        {!own && <Lock size={11} role="img" aria-label={strings.lib.lockedPack} />}
        <span>{pack.id}</span>
        <span className="logic-pack-ver">{pack.version}</span>
      </div>
      {pack.functions.length === 0 && <p className="empty logic-pack-empty">{strings.lib.dropTip}</p>}
      <ul className="graph-list" role="list">
        {pack.functions.map((fn) => (
          <GraphRowView
            key={fn.id}
            id={fn.id}
            name={fn.name}
            scope="function"
            sig={fn.signature}
            active={activeId === fn.id}
            {...(own || pack.origin === 'core' ? {} : { locked: strings.lib.locked })}
            onOpen={() => openLibraryFunction(swf, fn)}
            onRename={(n) => renameLibraryFunction(swf, fn, n)}
            onDelete={() => void removeFn(fn)}
            extra={<Btn icon={Copy} variant="quiet" label={strings.lib.copyTip(fn.name)} onClick={() => void copy(fn)} testId="library-copy" />}
          />
        ))}
      </ul>
    </div>
  )
}
