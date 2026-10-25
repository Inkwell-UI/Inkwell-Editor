import { scriptsOf } from '../../shared/graphs'
import type { OverlayDoc } from '../../shared/overlay'

/**
 * One selection model (UX 2.4): selecting a component selects its graph. Returns the graph to open for `component`, or undefined to keep the current one
 * (the component has no graph, or the open graph is already one of its graphs). Only graphs that exist count.
 */
export function graphForComponent(overlay: OverlayDoc | undefined, component: string, existing: readonly string[], current: string | undefined): string | undefined {
  const mine = scriptsOf(overlay?.nodes?.[component]).filter((id) => existing.includes(id))
  return mine.length === 0 || (current !== undefined && mine.includes(current)) ? undefined : mine[0]
}

/** The layers a graph is attached to (their overlay `scripts` list it), for the breadcrumb and the Navigator. */
export function ownersOfGraph(overlay: OverlayDoc | undefined, graphId: string): string[] {
  return Object.entries(overlay?.nodes ?? {}).flatMap(([id, entry]) => (scriptsOf(entry).includes(graphId) ? [id] : []))
}
