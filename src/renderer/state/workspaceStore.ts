import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { tabsKeyOf } from '../workspace/layout'
import { isWorkspaceId, WORKSPACE_IDS, WORKSPACES, type WorkspaceId } from '../workspace/workspaces'
import { safeStorage } from './safeStorage'

/**
 * The active workspace and what each workspace remembers about its own arrangement: split sizes and the chosen tab of each tab group.
 * Persisted in the renderer only (localStorage behind `safeStorage`); nothing is written into the project.
 *
 * API: `active`, `sizes[ws][nodeKey]`, `tabs[ws][nodeKey]` (keys: see `nodeKey` in workspace/layout.ts);
 * `setActive(id)`, `setSizes(key, sizes | undefined)` (undefined resets that split), `setTab(key, panelId)`,
 * `showDockTab(panelId)` (opens the tab of the active workspace that holds the panel), `reset(ws?)`.
 */
export interface WorkspaceStore {
  active: WorkspaceId
  sizes: Record<WorkspaceId, Record<string, number[]>>
  tabs: Record<WorkspaceId, Record<string, string>>
  setActive(id: WorkspaceId): void
  setSizes(key: string, sizes: number[] | undefined): void
  setTab(key: string, panel: string): void
  showDockTab(panel: string): void
  reset(ws?: WorkspaceId): void
}

type Persisted = Pick<WorkspaceStore, 'active' | 'sizes' | 'tabs'>

const empty = <T>(): Record<WorkspaceId, Record<string, T>> => ({ wire: {}, verify: {}, debug: {} })

/** Defensive read of whatever localStorage held: wrong shapes and unknown ids are dropped, never thrown on. */
export function sanitizePersisted(raw: unknown): Persisted {
  const out: Persisted = { active: 'wire', sizes: empty(), tabs: empty() }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (isWorkspaceId(r['active'])) out.active = r['active']
  for (const ws of WORKSPACE_IDS) {
    const sz = (r['sizes'] as Record<string, unknown> | undefined)?.[ws]
    if (sz && typeof sz === 'object')
      for (const [k, v] of Object.entries(sz))
        if (Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === 'number' && n > 0 && Number.isFinite(n))) out.sizes[ws][k] = v as number[]
    const tb = (r['tabs'] as Record<string, unknown> | undefined)?.[ws]
    if (tb && typeof tb === 'object') for (const [k, v] of Object.entries(tb)) if (typeof v === 'string') out.tabs[ws][k] = v
  }
  return out
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      ...sanitizePersisted(undefined),
      setActive: (active) => set({ active }),
      setSizes: (key, sizes) =>
        set((s) => {
          const cur = { ...s.sizes[s.active] }
          if (sizes) cur[key] = sizes
          else delete cur[key]
          return { sizes: { ...s.sizes, [s.active]: cur } }
        }),
      setTab: (key, panel) => set((s) => ({ tabs: { ...s.tabs, [s.active]: { ...s.tabs[s.active], [key]: panel } } })),
      showDockTab: (panel) => {
        const key = tabsKeyOf(WORKSPACES[get().active].layout, panel)
        if (key) get().setTab(key, panel)
      },
      reset: (ws) =>
        set((s) => (ws ? { sizes: { ...s.sizes, [ws]: {} }, tabs: { ...s.tabs, [ws]: {} } } : { sizes: empty(), tabs: empty() }))
    }),
    {
      name: 'inkwell.workspaces.v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s): Persisted => ({ active: s.active, sizes: s.sizes, tabs: s.tabs }),
      merge: (persisted, current) => ({ ...current, ...sanitizePersisted(persisted) })
    }
  )
)
