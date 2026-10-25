import { useMemo } from 'react'
import type { ProjectState, SwfDoc } from '../../shared/projectState'
import { getOverlayStore } from '../state/overlayStore'
import { useProjectStore } from '../state/projectStore'
import { create, useStore } from 'zustand'
import { buildDockRows, type DockRow } from '../model/lintRows'
import { useSyncState } from './useSyncState'
import type { OverlayDoc } from '../../shared/overlay'

/** The open project (undefined while loading, null when none is open). */
export const useProject = (): ProjectState | null | undefined => useProjectStore((s) => s.project)

/** The active SWF (IR + overlay as loaded; the overlay in use is `useActiveOverlay()`). */
export function useActiveSwf(): SwfDoc | undefined {
  const project = useProjectStore((s) => s.project)
  const id = useProjectStore((s) => s.activeSwfId)
  return useMemo(() => project?.swfs.find((s) => s.id === id), [project, id])
}

/** The active SWF's overlay from its own undoable store (one history per SWF). Undefined when there is no SWF. */
export function useActiveOverlay(): OverlayDoc | undefined {
  const swf = useActiveSwf()
  const store = swf ? getOverlayStore(swf.id, swf.name, swf.overlay) : undefined
  // a store always exists for hooks; when there is no swf subscribe to a dummy selector
  return useStore(store ?? emptyStore, (s) => s.doc) as OverlayDoc | undefined
}

const emptyStore = create(() => ({ doc: undefined as OverlayDoc | undefined }))

/** Every row of the Lint dock (strict mode applied), unfiltered. One source for the Navigator badges, Inspector issues and the dock. */
export function useDockRows(): DockRow[] {
  const sync = useSyncState()
  const strict = useProjectStore((s) => s.project?.strictMode ?? false)
  return useMemo(
    () =>
      buildDockRows({
        lint: [...(sync?.lint ?? []), ...(sync?.graphLint ?? [])],
        ...(sync?.looseLayers ? { looseLayers: sync.looseLayers } : {}),
        ...(sync?.unreachableNodes ? { unreachable: sync.unreachableNodes } : {}),
        ...(sync ? { build: sync.build } : {}),
        ...(sync?.buildError ? { buildError: sync.buildError } : {}),
        strict
      }),
    [sync?.lint, sync?.graphLint, sync?.looseLayers, sync?.unreachableNodes, sync?.build, sync?.buildError, strict]
  )
}
