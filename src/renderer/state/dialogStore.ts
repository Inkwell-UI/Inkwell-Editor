import { create } from 'zustand'

/** Which stub dialog is open (`configOwnership`, `setupDoctor`, `figmaSetup`), or null. API: `open`, `show(id)`, `close()`. */
export type DialogId = 'configOwnership' | 'setupDoctor' | 'figmaSetup'
export interface DialogStore {
  open: DialogId | null
  show(id: DialogId): void
  close(): void
}
export const useDialogStore = create<DialogStore>()((set) => ({ open: null, show: (open) => set({ open }), close: () => set({ open: null }) }))
