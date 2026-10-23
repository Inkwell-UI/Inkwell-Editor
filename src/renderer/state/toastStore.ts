import { create } from 'zustand'

export interface Toast {
  id: number
  tone: 'ok' | 'error' | 'info'
  title: string
  text?: string
}
/** Short-lived messages (Deploy result). API: `toasts`, `push(t)` (auto-dismisses), `dismiss(id)`. */
export interface ToastStore {
  toasts: Toast[]
  push(t: Omit<Toast, 'id'>, ms?: number): void
  dismiss(id: number): void
}
let next = 1
export const useToastStore = create<ToastStore>()((set, get) => ({
  toasts: [],
  push: (t, ms = 8000) => {
    const id = next++
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) })
    if (ms > 0) setTimeout(() => get().dismiss(id), ms)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))
