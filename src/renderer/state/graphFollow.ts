import { create } from 'zustand'

/**
 * Whether the Graph panel follows the selected layer. Session state only.
 * - `locked`: the Graph panel's lock button; the open graph stays whatever is selected.
 * - `skip`: set by a Ctrl+Click on a layer (Navigator): that one selection does not open the layer's graph.
 */
interface FollowState {
  locked: boolean
  skip: boolean
  setLocked(on: boolean): void
  skipNext(): void
  /** True once when a skip was asked for. */
  takeSkip(): boolean
}
export const useGraphFollow = create<FollowState>()((set, get) => ({
  locked: false,
  skip: false,
  setLocked: (locked) => set({ locked }),
  skipNext: () => set({ skip: true }),
  takeSkip: () => {
    const was = get().skip
    if (was) set({ skip: false })
    return was
  }
}))
