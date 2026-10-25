import { create } from 'zustand'
import {
  clearSelection, initialSelection, pruneSelection, resolveFigmaSelection, revealGraphNode as pickReveal, selectComponent as pickComponent, selectFromLint as pickFromLint,
  selectGraphNode as pickGraphNode, type ComponentSource, type SelectionState
} from '../model/selection'
import { useSettingsStore } from './settingsStore'

/**
 * THE selection (UX 2.4): one selected component, one selected graph node, and what the Inspector shows. The rules are the pure
 * functions in `model/selection.ts` (table in its header and in docs/ui-shell.md); this store only applies them.
 *
 * Read: `component`, `graphNode` (+ `graph`, the graph it lives in), `reveal` (a request to open that graph and centre the node), `inspects` ('none' | 'component' | 'graphNode'), `issue` (lint issue to highlight).
 * Write:
 * - `selectComponent(id, source)`: Navigator row or stage click (`'navigator' | 'stage'`); Figma mirroring uses `applyFigmaSelection`.
 * - `selectGraphNode(nodeId, targetComponent?, graph?)`: graph click.
 * - `selectFromLint({key, nodeId?, graphNode?, graph?})`: lint row click; with a graph node it also reveals it.
 * - `revealGraphNode(graph, nodeId)`: a trace line or an AS2 line; the caller activates the SWF and opens the graph (`setActiveGraph`).
 * - `applyFigmaSelection(ids, swfs, activeSwfId)`: Figma -> Inkwell; does nothing when the "mirror Figma selection" setting is off.
 *   Returns the resolved SWF/node (the caller activates the SWF) or undefined.
 * - `clear()`, `prune(exists)`.
 * `origin` is `'local'` when this window made the change and `'remote'` when it came from another window (not re-broadcast).
 * Inkwell -> Figma selection does not exist yet (no protocol message): nothing here tells Figma anything.
 */
export interface SelectionStore extends SelectionState {
  origin: 'local' | 'remote'
  selectComponent(id: string, source: Exclude<ComponentSource, 'figma'>): void
  selectGraphNode(nodeId: string, target?: string, graph?: string): void
  selectFromLint(issue: { key: string; nodeId?: string; graphNode?: string; graph?: string }): void
  revealGraphNode(graph: string, nodeId: string): void
  /** Bumped by every reveal: the Graph panel centres `node` when `graph` is the open one. */
  reveal?: { graph: string; node: string; n: number }
  applyFigmaSelection(ids: readonly string[], swfs: readonly { swfId: string; has(nodeId: string): boolean }[], activeSwfId?: string): { swfId: string; nodeId: string } | undefined
  /** Selection arriving from another window (the detached preview). */
  applyRemote(nodeId: string): void
  clear(): void
  prune(exists: (nodeId: string) => boolean): void
}

const local = (s: SelectionState): Partial<SelectionStore> => ({ ...base(), ...s, origin: 'local' })
/** Resets optional fields so a replaced state does not keep stale `issue`/`graphNode` from the previous one. */
const base = (): Partial<SelectionStore> => ({ component: undefined, graphNode: undefined, graph: undefined, issue: undefined })

export const useSelectionStore = create<SelectionStore>()((set, get) => ({
  ...initialSelection,
  origin: 'local',
  selectComponent: (id, source) => set(local(pickComponent(get(), id, source))),
  selectGraphNode: (nodeId, target, graph) => set(local(pickGraphNode(get(), nodeId, target, graph))),
  selectFromLint: (issue) =>
    set({ ...local(pickFromLint(get(), issue)), ...(issue.graph && issue.graphNode ? { reveal: { graph: issue.graph, node: issue.graphNode, n: (get().reveal?.n ?? 0) + 1 } } : {}) }),
  revealGraphNode: (graph, nodeId) => set({ ...local(pickReveal(get(), graph, nodeId)), reveal: { graph, node: nodeId, n: (get().reveal?.n ?? 0) + 1 } }),
  applyFigmaSelection: (ids, swfs, activeSwfId) => {
    if (!useSettingsStore.getState().mirrorFigma) return undefined
    const hit = resolveFigmaSelection(ids, swfs, activeSwfId)
    if (hit) set({ ...base(), ...pickComponent(get(), hit.nodeId, 'figma'), origin: 'remote' })
    return hit
  },
  applyRemote: (nodeId) => set({ ...base(), ...pickComponent(get(), nodeId, 'stage'), origin: 'remote' }),
  clear: () => set({ ...base(), ...clearSelection(), origin: 'local' }),
  prune: (exists) => {
    const next = pruneSelection(get(), exists)
    if (next !== get()) set({ ...base(), ...next, origin: 'local' })
  }
}))
