import type { PreviewBackend } from './backend'

/**
 * How panels other than the preview reach the running movie (Play panel: call an entry; mock data). The preview panel `attach`es its backend,
 * panels call `call`. Panels must not import each other, so this is a module-level handle, like a store. One backend per window: with the preview popped
 * out into its own window, the main window has none and `call` returns false (the Play panel says so).
 */
let current: PreviewBackend | undefined
const subs = new Set<() => void>()
export const previewBus = {
  attach(b: PreviewBackend): () => void {
    current = b
    subs.forEach((cb) => cb())
    return () => {
      if (current === b) current = undefined
      subs.forEach((cb) => cb())
    }
  },
  available: (): boolean => current !== undefined,
  subscribe: (cb: () => void): (() => void) => (subs.add(cb), () => void subs.delete(cb)),
  call: (fn: string, ...args: unknown[]): boolean => current?.call(fn, ...args) ?? false
}
