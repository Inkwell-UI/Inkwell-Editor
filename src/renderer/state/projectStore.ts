import { create } from 'zustand'
import type { ProjectState, SwfDoc } from '../../shared/projectState'
import { resetGraphDocs } from './graphDocs'
import { resetOverlays } from './overlayStore'

/**
 * The open project and the active SWF. API: `project` (undefined = main has not answered yet, null = none open: start screen),
 * `activeSwfId`, `setProject(p)`, `setActiveSwf(id)`. The data comes from main over IPC (`state/bridge.ts` calls `setProject`);
 * panels read it through `useActiveSwf()` (hooks/useProject.ts). Opening a different project drops the overlay histories.
 */
export interface ProjectStore {
  project: ProjectState | null | undefined
  activeSwfId: string | undefined
  setProject(p: ProjectState | null): void
  setActiveSwf(id: string): void
}

/** The requested SWF if it exists, else the first one that is not orphaned, else the first. */
export function resolveActiveSwf(swfs: readonly Pick<SwfDoc, 'id' | 'orphaned'>[], wanted?: string): string | undefined {
  return swfs.find((s) => s.id === wanted)?.id ?? swfs.find((s) => !s.orphaned)?.id ?? swfs[0]?.id
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  project: undefined,
  activeSwfId: undefined,
  setProject: (project) => {
    if (get().project?.dir !== project?.dir) (resetOverlays(), resetGraphDocs())
    set({ project, activeSwfId: resolveActiveSwf(project?.swfs ?? [], get().activeSwfId) })
  },
  setActiveSwf: (id) => set({ activeSwfId: resolveActiveSwf(get().project?.swfs ?? [], id) })
}))
