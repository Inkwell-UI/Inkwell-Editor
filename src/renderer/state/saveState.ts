import { create } from 'zustand'

export type SaveState = 'saved' | 'saving' | 'unsaved'

/** Edits waiting for their debounce are unsaved; writes sent to main and not answered yet are saving; otherwise saved. */
export const saveStateOf = (p: { queued: number; inflight: number }): SaveState => (p.queued > 0 ? 'unsaved' : p.inflight > 0 ? 'saving' : 'saved')

interface SaveStore {
  /** Graphs whose last edit still waits for its debounce (set by graphStore). */
  queued: number
  /** IPC saves (graph, overlay, menu, localization) sent and not answered yet. */
  inflight: number
}
export const useSaveStore = create<SaveStore>()(() => ({ queued: 0, inflight: 0 }))
export const useSaveState = (): SaveState => useSaveStore((s) => saveStateOf(s))

export const setQueuedSaves = (queued: number): void => useSaveStore.setState({ queued })

/** Counts a save while its promise is pending (a save that returns nothing is not tracked). */
export function trackSave(p: Promise<unknown> | void): void {
  if (!p) return
  useSaveStore.setState((s) => ({ inflight: s.inflight + 1 }))
  void Promise.resolve(p).catch(() => undefined).finally(() => useSaveStore.setState((s) => ({ inflight: s.inflight - 1 })))
}

/** Resolves when nothing is queued or in flight (immediately if already so). */
export const whenSaved = (): Promise<void> =>
  new Promise((resolve) => {
    if (saveStateOf(useSaveStore.getState()) === 'saved') return resolve()
    const off = useSaveStore.subscribe((s) => {
      if (saveStateOf(s) !== 'saved') return
      off()
      resolve()
    })
  })
