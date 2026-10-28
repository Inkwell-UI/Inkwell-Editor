import type { Graph, Node } from '@inkwell-ui/spec'
import { withPropCopies } from '../../shared/graphs'
import { readComponentGraphs } from './componentFiles'
import { readComponentTrees } from './componentTrees'

/** A component the compiler turns into a library symbol the code can add at runtime: its Figma id and what it is made of. */
export interface ComponentSource {
  id: string
  name: string
  nodes: Record<string, Node>
}

/**
 * The components to compile into a SWF: the ones kept on the Figma page away from the design (`figma/components/`) that have a graph (`components/`). Components inside a SWF's own design are
 * drawn where they are and not compiled a second time as symbols. shortcut: components without a graph are not compiled; add the ones a Create Component node names when that node exists.
 */
export async function loadComponentSources(project: string): Promise<{ sources: ComponentSource[]; graphs: Graph[] }> {
  const graphs = (await readComponentGraphs(project)).graphs.map(withPropCopies)
  const withGraph = new Set(graphs.flatMap((g) => (g.component ? [g.component] : [])))
  const sources = (await readComponentTrees(project)).filter((t) => withGraph.has(t.id))
  return { sources, graphs }
}
