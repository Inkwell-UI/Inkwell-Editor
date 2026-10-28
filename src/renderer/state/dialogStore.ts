import { create } from 'zustand'

/** Which stub dialog is open (`configOwnership`, `figmaSetup`) or a full-window view (`settings`, `projectSettings`, see AppShell), or null. API: `open`, `show(id)`, `close()`. */
export type DialogId = 'configOwnership' | 'settings' | 'projectSettings' | 'figmaSetup'
export interface DialogStore {
  open: DialogId | null
  show(id: DialogId): void
  close(): void
}
export const useDialogStore = create<DialogStore>()((set) => ({ open: null, show: (open) => set({ open }), close: () => set({ open: null }) }))
