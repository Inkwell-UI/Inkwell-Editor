import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { temporal, type TemporalState } from 'zundo'
import type { MenuSettings } from '@inkwell-ui/spec'
import type { SaveOverlayResult } from '../../shared/ipc'
import { registerHistory } from './swfHistory'

/**
 * `swfs/<name>/menu.json` with undo: one store per SWF, registered in the SWF's one undo history (swfHistory.ts) like the overlay and its graphs.
 * Like the overlay, the renderer is the source of truth while the project is open; every change (edit, undo, redo) is saved through the saver
 * set by `setMenuSaver` (IPC `saveMenuSettings`). Localization and project.json settings are project-wide, not per SWF, and stay outside this history.
 */
interface MenuState {
  doc: MenuSettings
  setDoc(doc: MenuSettings): void
}
export type MenuStore = UseBoundStore<StoreApi<MenuState>> & { temporal: StoreApi<TemporalState<Pick<MenuState, 'doc'>>> }

const stores = new Map<string, { name: string; store: MenuStore }>()
let saver: ((name: string, doc: MenuSettings) => Promise<SaveOverlayResult>) | undefined
export const setMenuSaver = (fn: typeof saver): void => void (saver = fn)

export function getMenuStore(swfId: string, name: string, initial: MenuSettings): MenuStore {
  const hit = stores.get(swfId)
  if (hit) {
    hit.name = name
    return hit.store
  }
  const store = create<MenuState>()(
    temporal((set) => ({ doc: initial, setDoc: (doc) => set({ doc }) }), { limit: 100, partialize: (s) => ({ doc: s.doc }) })
  ) as unknown as MenuStore
  const entry = { name, store }
  stores.set(swfId, entry)
  registerHistory(swfId, 'menu', store.temporal)
  // Undo and redo save here; an edit from the form saves in `editMenu` so it can report the result.
  store.subscribe((s, prev) => {
    if (s.doc !== prev.doc && !saving) void saver?.(entry.name, s.doc)
  })
  return store
}

let saving = false
/** One history entry; resolves with the save result. */
export function editMenu(swfId: string, next: MenuSettings): Promise<SaveOverlayResult> {
  const e = stores.get(swfId)
  if (!e) throw new Error(`No menu store for swf ${swfId}`)
  saving = true
  try {
    e.store.getState().setDoc(next)
  } finally {
    saving = false
  }
  return saver ? saver(e.name, next) : Promise.resolve({ ok: true } as SaveOverlayResult)
}

export const resetMenus = (): void => stores.clear()
