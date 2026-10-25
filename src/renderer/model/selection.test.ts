import { describe, expect, it } from 'vitest'
import { clearSelection, initialSelection, pruneSelection, resolveFigmaSelection, revealGraphNode, selectComponent, selectFromLint, selectGraphNode, SELECTION_RULES } from './selection'

describe('selection model (UX 2.4)', () => {
  it('navigator/stage/figma set the component and keep the graph node', () => {
    const s = selectGraphNode(initialSelection, 'g1', 'a')
    for (const src of ['navigator', 'stage', 'figma'] as const) {
      expect(selectComponent(s, 'b', src)).toEqual({ component: 'b', graphNode: 'g1', inspects: 'component' })
    }
  })
  it('a graph node click sets the node and its target component; without a target the component stays', () => {
    expect(selectGraphNode({ component: 'a', inspects: 'component' }, 'g', 'b')).toEqual({ component: 'b', graphNode: 'g', inspects: 'graphNode' })
    expect(selectGraphNode({ component: 'a', inspects: 'component' }, 'g')).toEqual({ component: 'a', graphNode: 'g', inspects: 'graphNode' })
  })
  it('a lint row selects the component, the issue graph node if any, and highlights the issue', () => {
    const s = { component: 'a', graphNode: 'g0', inspects: 'graphNode' as const }
    expect(selectFromLint(s, { key: 'k', nodeId: 'b' })).toEqual({ component: 'b', graphNode: 'g0', inspects: 'component', issue: 'k' })
    expect(selectFromLint(s, { key: 'k', nodeId: 'b', graphNode: 'g9' }).graphNode).toBe('g9')
  })
  it('a graph node remembers its graph; a lint row for a graph node shows the node in the Inspector', () => {
    expect(selectGraphNode(initialSelection, 'n', undefined, 'main')).toEqual({ graphNode: 'n', graph: 'main', inspects: 'graphNode' })
    expect(selectComponent(selectGraphNode(initialSelection, 'n', 'a', 'main'), 'b', 'navigator')).toMatchObject({ component: 'b', graphNode: 'n', graph: 'main' })
    expect(selectFromLint(initialSelection, { key: 'k', nodeId: 'b', graphNode: 'n', graph: 'main' })).toEqual({ component: 'b', graphNode: 'n', graph: 'main', inspects: 'graphNode', issue: 'k' })
    expect(selectFromLint({ graphNode: 'old', graph: 'g', inspects: 'graphNode' }, { key: 'k', nodeId: 'b' })).toMatchObject({ graphNode: 'old', graph: 'g', inspects: 'component' })
    expect(revealGraphNode({ component: 'a', inspects: 'component' }, 'main', 'n')).toEqual({ component: 'a', graph: 'main', graphNode: 'n', inspects: 'graphNode' })
  })
  it('a later selection clears the issue highlight', () => {
    expect(selectComponent(selectFromLint(initialSelection, { key: 'k', nodeId: 'b' }), 'c', 'navigator').issue).toBeUndefined()
  })
  it('the table has a rule for every source', () => {
    expect(Object.keys(SELECTION_RULES).sort()).toEqual(['figma', 'graph', 'lint', 'navigator', 'stage'])
    expect(SELECTION_RULES.graph.figma).toBe('unchanged')
    expect(SELECTION_RULES.figma.figma).toBe('origin')
  })
  it('prune drops a missing component only', () => {
    expect(pruneSelection({ component: 'x', inspects: 'component' }, () => false)).toEqual({ inspects: 'none' })
    expect(pruneSelection({ component: 'x', graphNode: 'g', inspects: 'component' }, () => false)).toEqual({ graphNode: 'g', inspects: 'graphNode' })
    const keep = { component: 'x', inspects: 'component' as const }
    expect(pruneSelection(keep, () => true)).toBe(keep)
    expect(clearSelection()).toEqual({ inspects: 'none' })
  })
  it('resolves a Figma selection to the active SWF first, else any SWF, else nothing', () => {
    const swfs = [{ swfId: 'A', has: (i: string) => i === '1' }, { swfId: 'B', has: (i: string) => i === '1' || i === '2' }]
    expect(resolveFigmaSelection(['1'], swfs, 'B')).toEqual({ swfId: 'B', nodeId: '1' })
    expect(resolveFigmaSelection(['2'], swfs, 'A')).toEqual({ swfId: 'B', nodeId: '2' })
    expect(resolveFigmaSelection(['9', '1'], swfs, 'A')).toEqual({ swfId: 'A', nodeId: '1' })
    expect(resolveFigmaSelection(['9'], swfs, 'A')).toBeUndefined()
    expect(resolveFigmaSelection([], swfs)).toBeUndefined()
  })
})
