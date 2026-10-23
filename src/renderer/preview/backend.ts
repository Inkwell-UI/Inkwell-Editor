import type { PreviewBuild } from '../../shared/preview'

/** What a preview implementation reports. `firstFrame` fires once per `load`, after the first frame was drawn. */
export interface PreviewBackendEvents {
  loaded: undefined
  error: string
  firstFrame: undefined
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
  /** Stops the movie and releases everything; the backend is unusable afterwards. */
  dispose(): void
}
