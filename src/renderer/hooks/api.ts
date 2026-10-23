import type { InkwellApi } from '../../shared/ipc'

/** The preload API; undefined when the renderer runs outside Electron (a plain browser). */
export const inkwell: InkwellApi | undefined = typeof window === 'undefined' ? undefined : (window as unknown as { inkwell?: InkwellApi }).inkwell
