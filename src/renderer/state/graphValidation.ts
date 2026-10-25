import { createValidation, graphChanged, groupIssues } from '@nicklaj/knotwork'
import { validateGraph, type GraphIssue, type ValidateCtx } from '../../shared/graphValidate'
import { toGraph, type GraphStore } from './graphStore'

/**
 * Live validation of one open graph for node badges: Knotwork's `createValidation` around the shared `validateGraph` (the same function the main
 * process runs for the Lint dock and the export gate). Components read `use` (`issues`, `byNode`, `fieldsByNode`) and never recompute.
 * `start()` returns the stop function; it re-runs (debounced) when nodes, wires or variables change, not on selection or measuring.
 */
export function createGraphValidation(store: GraphStore, ctx: () => ValidateCtx) {
  const v = createValidation<{ issues: GraphIssue[]; byNode: Record<string, string>; fieldsByNode: Record<string, string> }>({
    compute: () => {
      const issues = validateGraph(toGraph(store.getState()), ctx())
      return { issues, ...groupIssues(issues) }
    }
  })
  return {
    use: v.use,
    start: () => v.start([(schedule) => store.subscribe((s, p) => (graphChanged(s, p) || s.variables !== p.variables) && schedule())])
  }
}
