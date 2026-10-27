import type { PreviewBuild } from '../../shared/preview'

/** What a preview implementation reports. `firstFrame` fires once per `load`, after the first frame was drawn. */
export interface PreviewBackendEvents {
  loaded: undefined
  error: string
  firstFrame: undefined
  /** One line of the movie's `trace()` output (docs/debugging.md, Trace channel). */
  trace: string
}

/**
 * "Show this build result." The only 1.0 implementation is RuffleBackend (an approximation of Flash, not GFx); anything that can draw an
 * SWF into a DOM element can replace it. The backend owns `element`; the host (SwfViewport) only positions and sizes it.
 */
export interface PreviewBackend {
  /** The DOM node showing the movie. Stable for the backend's lifetime. */
  readonly element: HTMLElement
  /** Shows `build.bytes` (replacing what was shown). Resolves once the movie loaded; rejects when it cannot. */
  load(build: PreviewBuild): Promise<void>
  /** Subscribes to an event; returns the unsubscribe function. */
  on<E extends keyof PreviewBackendEvents>(event: E, cb: (value: PreviewBackendEvents[E]) => void): () => void
  /** Calls an `ExternalInterface` callback of the running movie (the preview shims in swf/generate.ts: `inkwellCall`, `inkwellMock`...). False when nothing is running, it has no such callback, or the callback answered false (`inkwellCall`: no such clip method). */
  call(fn: string, ...args: unknown[]): boolean
  /** Freezes (true) or continues (false) the running movie: timers, tweens and the timeline. A new `load` always starts playing. */
  setPaused(paused: boolean): void
  /** Stops the movie and releases everything; the backend is unusable afterwards. */
  dispose(): void
}
