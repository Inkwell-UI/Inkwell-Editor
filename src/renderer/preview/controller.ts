import type { PreviewBuild, PreviewRendered } from '../../shared/preview'
import type { PreviewBackend } from './backend'

export interface PreviewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  seq?: number
  error?: string
  /** Build received -> first frame, in ms (set when `ready`). */
  ms?: number
}

export interface PreviewController {
  readonly backend: PreviewBackend
  getState(): PreviewState
  subscribe(cb: () => void): () => void
  /** Shows a build. A newer `show` supersedes an older one still loading. A build without bytes shows its build error. */
  show(build: PreviewBuild): Promise<void>
  /** Shows the last build again. */
  reload(): Promise<void>
  dispose(): void
}

/** DOM-free logic of the preview panel: loads builds into a backend, measures build-ready -> first frame, ignores stale results. */
export function createPreviewController(opts: {
  backend: PreviewBackend
  report: (r: PreviewRendered) => void
  now?: () => number
}): PreviewController {
  const { backend, report } = opts
  const now = opts.now ?? (() => performance.now())
  let state: PreviewState = { status: 'idle' }
  let last: PreviewBuild | undefined
  let token = 0
  let t0 = 0
  const subs = new Set<() => void>()
  const set = (s: PreviewState): void => {
    state = s
    subs.forEach((cb) => cb())
  }

  const offs = [
    backend.on('firstFrame', () => {
      if (state.status !== 'loading' || !last) return
      const ms = now() - t0
      set({ status: 'ready', seq: last.seq, ms })
      report({ seq: last.seq, ms })
    }),
    backend.on('error', (error) => {
      if (state.status === 'loading') set({ status: 'error', ...(last ? { seq: last.seq } : {}), error })
    })
  ]

  const show = async (build: PreviewBuild): Promise<void> => {
    const mine = ++token
    last = build
    if (!build.bytes) {
      set({ status: 'error', seq: build.seq, error: build.error ?? 'No preview was built.' })
      return
    }
    t0 = now()
    set({ status: 'loading', seq: build.seq })
    try {
      await backend.load(build)
    } catch (e) {
      if (mine === token) set({ status: 'error', seq: build.seq, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    backend,
    getState: () => state,
    subscribe: (cb) => (subs.add(cb), () => subs.delete(cb)),
    show,
    reload: async () => {
      if (last) await show(last)
    },
    dispose: () => {
      offs.forEach((off) => off())
      subs.clear()
      backend.dispose()
    }
  }
}
