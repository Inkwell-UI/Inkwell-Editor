import { focusGraph, resolvePrompt, type PromptDevice, type Swf } from '@inkwell-ui/spec'
import type { LintIssue } from '../swf/lint'

/**
 * Focus graph (W3) and prompts (W4) of one SWF from its overlay: the compile options of a custom menu and their lint. Focus issues come from the Spec's `focusGraph`
 * (`focus-unreachable`, `focus-dead-end`, `focus-target-missing` errors; `focus-node-missing`, `focus-direction-unknown` warnings); a role-`prompt` layer whose data cannot
 * be built is `prompt-invalid` (error). Outside a custom menu the data is kept but unused (`focus-not-menu` warning).
 */
export function focusOptions(ir: Swf, nodes: Record<string, Record<string, unknown>>): {
  focus?: { order: string[]; moves: ReturnType<typeof focusGraph>['moves'] }
  prompts?: Record<string, Partial<Record<PromptDevice, string>>>
  lint: LintIssue[]
} {
  const name = (id: string): string => ir.nodes[id]?.name ?? id
  const g = focusGraph(nodes, (id) => id in ir.nodes)
  const lint: LintIssue[] = g.issues.map((i) => ({ ...i, nodeName: name(i.nodeId) }))
  const prompts: Record<string, Partial<Record<PromptDevice, string>>> = {}
  for (const [id, o] of Object.entries(nodes)) {
    if (o['role'] !== 'prompt' || !(id in ir.nodes)) continue
    const r = resolvePrompt(o['prompt'])
    for (const p of r.problems) lint.push({ severity: 'error', code: 'prompt-invalid', nodeId: id, nodeName: name(id), message: p })
    if (!r.problems.length) prompts[id] = r.glyphs
  }
  if (ir.target.kind !== 'customMenu') {
    const used = g.order.length ? g.order[0]! : Object.keys(prompts)[0]
    return { lint: used ? [{ severity: 'warning', code: 'focus-not-menu', nodeId: used, nodeName: name(used), message: 'Focus graphs and prompts work in custom menus only; this SWF keeps the data but does not use it.' }] : [] }
  }
  return { ...(g.order.length ? { focus: { order: g.order, moves: g.moves } } : {}), ...(Object.keys(prompts).length ? { prompts } : {}), lint }
}

/** True when the overlay gives any layer a focus order (the menu needs `inputContext` menuMode, S-A). */
export const hasFocusGraph = (nodes: Record<string, unknown>): boolean =>
  Object.values(nodes).some((o) => typeof (o as { focus?: { order?: unknown } } | undefined)?.focus?.order === 'number')
