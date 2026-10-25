import type { MockData } from '../../shared/graphBinding'
import type { PreviewBackend } from './backend'

/**
 * Mock data -> the running preview movie (docs/debugging.md, Mock data): clears `Inkwell.mock`, sets every key through the `inkwellMock` callbacks
 * of the preview shim (swf/generate.ts), then `inkwellMockDone` lets the graph classes re-read it (variables named like a key, `mock:` bindings).
 * False when the movie has no bridge (not started, or a build without the shim).
 */
export function deliverMock(backend: Pick<PreviewBackend, 'call'>, data: MockData): boolean {
  if (!backend.call('inkwellMockReset')) return false
  for (const [k, v] of Object.entries(data)) backend.call('inkwellMock', k, v)
  return backend.call('inkwellMockDone')
}
