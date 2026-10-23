/**
 * The selection model (UX architecture 2.4), as pure functions. There is exactly one selected component (a Figma layer with its overlay,
 * identified by node id) and one selected graph node. The Zustand store in `state/selectionStore.ts` only applies these.
 *
 * | Action                          | component             | graph node           | Inspector shows  | Figma                            |
 * | Navigator row / stage (Inspect) | set                   | keep                 | component        | would select the layer (planned) |
 * | Graph node                      | its target, else keep | set                  | graph node       | unchanged                        |
 * | Lint row                        | the issue's component | the issue's, or keep | component+issue  | would select the layer (planned) |
 * | Layer selected in Figma         | set                   | keep                 | component        | (origin)                         |
 *
 * Inkwell -> Figma selection is NOT possible yet (the protocol has no such message): `FIGMA_FOLLOWS_INKWELL` is false and the UI
 * says so. Figma -> Inkwell mirroring is a user setting (`mirrorFigma`), applied by the caller before it calls `selectComponent`.
 */
export type ComponentSource = 'navigator' | 'stage' | 'figma'
export type SelectionSource = ComponentSource | 'graph' | 'lint'

export interface SelectionState {
  component?: string
  graphNode?: string
  /** What the Inspector shows. */
  inspects: 'none' | 'component' | 'graphNode'
  /** Lint issue to highlight in the Inspector (set by a lint row click, cleared by any other selection). */
  issue?: string
}

export const FIGMA_FOLLOWS_INKWELL = false

export interface SelectionRule {
  component: 'set' | 'targetOrKeep'
  graphNode: 'keep' | 'set' | 'issueOrKeep'
  inspector: 'component' | 'graphNode'
  /** Does the source tell Figma to select the layer (once the protocol allows it)? */
  figma: 'select-layer' | 'unchanged' | 'origin'
}

export const SELECTION_RULES: Record<SelectionSource, SelectionRule> = {
  navigator: { component: 'set', graphNode: 'keep', inspector: 'component', figma: 'select-layer' },
  stage: { component: 'set', graphNode: 'keep', inspector: 'component', figma: 'select-layer' },
  graph: { component: 'targetOrKeep', graphNode: 'set', inspector: 'graphNode', figma: 'unchanged' },
  lint: { component: 'set', graphNode: 'issueOrKeep', inspector: 'component', figma: 'select-layer' },
  figma: { component: 'set', graphNode: 'keep', inspector: 'component', figma: 'origin' }
}

export const initialSelection: SelectionState = { inspects: 'none' }

export function selectComponent(s: SelectionState, id: string, _source: ComponentSource): SelectionState {
  return { ...(s.graphNode ? { graphNode: s.graphNode } : {}), component: id, inspects: 'component' }
}

/** A graph node click. `target` is the component the node refers to, if it has one. */
export function selectGraphNode(s: SelectionState, graphNode: string, target?: string): SelectionState {
  const component = target ?? s.component
  return { ...(component ? { component } : {}), graphNode, inspects: 'graphNode' }
}

/** A lint row click: the issue's component, its graph node if it has one (else the graph selection stays), the issue highlighted. */
export function selectFromLint(s: SelectionState, issue: { key: string; nodeId?: string; graphNode?: string }): SelectionState {
  const graphNode = issue.graphNode ?? s.graphNode
  const component = issue.nodeId ?? s.component
  return { ...(component ? { component } : {}), ...(graphNode ? { graphNode } : {}), inspects: component ? 'component' : s.inspects, issue: issue.key }
}

export const clearSelection = (): SelectionState => ({ inspects: 'none' })

/** Drops a selection whose node no longer exists (after the IR changed or another SWF became active). */
export function pruneSelection(s: SelectionState, exists: (nodeId: string) => boolean): SelectionState {
  if (!s.component || exists(s.component)) return s
  return { ...(s.graphNode ? { graphNode: s.graphNode } : {}), inspects: s.graphNode ? 'graphNode' : 'none' }
}

/**
 * Figma selection -> Inkwell: the first selected id that is a node of some SWF. Prefers the active SWF; otherwise the first SWF that has it.
 * `swfs` carries only a membership test (cheap): the caller builds it from the IR.
 */
export function resolveFigmaSelection(
  ids: readonly string[],
  swfs: readonly { swfId: string; has(nodeId: string): boolean }[],
  activeSwfId?: string
): { swfId: string; nodeId: string } | undefined {
  const active = swfs.find((s) => s.swfId === activeSwfId)
  for (const id of ids) {
    if (active?.has(id)) return { swfId: active.swfId, nodeId: id }
    const other = swfs.find((s) => s.has(id))
    if (other) return { swfId: other.swfId, nodeId: id }
  }
  return undefined
}
