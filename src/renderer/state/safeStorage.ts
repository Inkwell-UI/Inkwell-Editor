import type { StateStorage } from 'zustand/middleware'

/**
 * localStorage behind try/catch. It can be missing or throw (private window, blocked site data, no DOM in tests); then the UI simply
 * starts from defaults and nothing is remembered. Used only for per-user UI conveniences (workspace sizes, settings), never project data.
 */
export const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* not remembered */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* nothing to remove */
    }
  }
}
