import { createValidation, graphChanged, groupIssues } from '@nicklaj/knotwork'
import { validateGraph, type GraphIssue, type ValidateCtx } from '../../shared/graphValidate'
import { toGraph, type GraphStore } from './graphStore'

/**
 * Live validation of one open graph for node badges: Knotwork's `createValidation` around the shared `validateGraph` (the same function the main
 * process runs for the Lint dock and the export gate). Components read `use` (`issues`, `byNode`, `fieldsByNode`, `pinsByNode`) and never recompute.
 * `start()` returns the stop function; it re-runs (debounced) when nodes, wires or variables change, not on selection or measuring.
 */
export function createGraphValidation(store: GraphStore, ctx: () => ValidateCtx) {
  const v = createValidation<{ issues: GraphIssue[]; byNode: Record<string, string>; fieldsByNode: Record<string, string>; pinsByNode: Record<string, string> }>({
    compute: () => {
      const issues = validateGraph(toGraph(store.getState()), ctx())
      // pins with an issue per node, comma-joined, so a node's selector returns a primitive (one pass over the issues, not one per node)
      const pins = new Map<string, Set<string>>()
      for (const i of issues) if (i.nodeId && i.pin) (pins.get(i.nodeId) ?? pins.set(i.nodeId, new Set()).get(i.nodeId)!).add(i.pin)
      return { issues, ...groupIssues(issues), pinsByNode: Object.fromEntries([...pins].map(([id, set]) => [id, [...set].sort().join(',')])) }
    }
  })
  return {
    use: v.use,
    start: () => v.start([(schedule) => store.subscribe((s, p) => (graphChanged(s, p) || s.variables !== p.variables) && schedule())])
  }
}
