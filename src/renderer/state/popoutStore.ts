import { create } from 'zustand'

/**
 * Is the preview popped out into its own window? API: `detached`, `setDetached(b)` (fed by main via the bridge), `isPreviewWindow`
 * (this renderer was opened as the detached window: `?panel=preview`). Only the layout decision lives here: the main window drops the
 * preview panel while detached, so the graph gets the center (UX 2.3).
 */
export interface PopoutStore {
  detached: boolean
  setDetached(d: boolean): void
}
export const usePopoutStore = create<PopoutStore>()((set) => ({ detached: false, setDetached: (detached) => set({ detached }) }))

export const isPreviewWindow = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).get('panel') === 'preview'
