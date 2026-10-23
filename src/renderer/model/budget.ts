import type { Swf } from '@inkwell-ui/spec'

/**
 * PLACEHOLDER limits (UX 4.6, design spec "Performance budget"): not measured on real hardware yet. The UI shows `*` and a note.
 * Replace with measured values (and make them per-project settings) when they exist.
 */
export const BUDGET_LIMITS = { shapes: 150, masks: 4, alphaLayers: 8 } as const

export interface BudgetCounts {
  shapes: number
  masks: number
  alphaLayers: number
}

/** Counts over the nodes the root reaches (hidden nodes are not drawn and do not count). Alpha layers = nodes with opacity below 1. */
export function countBudget(ir: Swf): BudgetCounts {
  const c: BudgetCounts = { shapes: 0, masks: 0, alphaLayers: 0 }
  const seen = new Set<string>()
  const go = (id: string): void => {
    const n = ir.nodes[id]
    if (!n || seen.has(id) || !n.visible) return
    seen.add(id)
    if (n.type === 'shape') c.shapes++
    if (n.mask) c.masks++
    if (n.opacity < 1) c.alphaLayers++
    n.children.forEach(go)
  }
  go(ir.root)
  return c
}

export type BudgetState = 'ok' | 'near' | 'over'
/** `near` from 80 % of the limit. */
export const budgetState = (count: number, limit: number): BudgetState => (count > limit ? 'over' : count >= limit * 0.8 ? 'near' : 'ok')
