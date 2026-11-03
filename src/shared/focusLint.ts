import { focusGraph, resolvePrompt, type PromptDevice, type Swf } from '@inkwell-ui/spec'
import type { LintIssue } from './swfLint'

/**
 * Focus graph (W3) and prompts (W4) of one SWF from its overlay: the compile options of a custom menu and their lint. Focus issues come from the Spec's `focusGraph`
 * (`focus-unreachable`, `focus-dead-end`, `focus-target-missing` errors; `focus-node-missing`, `focus-direction-unknown` warnings); a role-`prompt` layer whose data cannot
 * be built is `prompt-invalid` (error). Outside a custom menu the data is kept but unused (`focus-not-menu` warning).
 */
export function focusOptions(ir: Swf, nodes: Record<string, Record<string, unknown>>): {
  focus?: { order: string[]; moves: ReturnType<typeof focusGraph>['moves'] }
  prompts?: Record<string, Partial<Record<PromptDevice, string>>>
  /** Per prompt the layers (absolute ids in this SWF) the designer chose as icon and label; unset = the defaults (a layer named promptIcon, the first text layer). */
  promptLayers?: Record<string, { icon?: string; label?: string }>
  lint: LintIssue[]
} {
  const name = (id: string): string => ir.nodes[id]?.name ?? id
  const g = focusGraph(nodes, (id) => id in ir.nodes)
  const lint: LintIssue[] = g.issues.map((i) => ({ ...i, nodeName: name(i.nodeId) }))
  const prompts: Record<string, Partial<Record<PromptDevice, string>>> = {}
  const promptLayers: Record<string, { icon?: string; label?: string }> = {}
  for (const [id, o] of Object.entries(nodes)) {
    if (o['role'] !== 'prompt' || !(id in ir.nodes)) continue
    if (ir.nodes[id]!.type === 'component') continue // a Figma component definition is not drawn in the menu, so it is never a prompt (an old role mark on it is ignored)
    const r = resolvePrompt(o['prompt'])
    for (const p of r.problems) lint.push({ severity: 'error', code: 'prompt-invalid', nodeId: id, nodeName: name(id), message: p })
    if (!r.problems.length) prompts[id] = r.glyphs
    // the layers the author chose as the icon place and the text (ids of layers inside this prompt)
    const raw = (o['prompt'] ?? {}) as Record<string, unknown>
    const layers: { icon?: string; label?: string } = {}
    for (const k of ['icon', 'label'] as const) {
      const v = raw[k]
      if (typeof v !== 'string' || !v) continue
      if (v in ir.nodes) layers[k] = v
      else lint.push({ severity: 'warning', code: 'prompt-layer-missing', nodeId: id, nodeName: name(id), message: `The ${k === 'icon' ? 'icon' : 'text'} layer chosen for this prompt no longer exists (renamed or deleted in Figma?); the default is used.` })
    }
    if (layers.icon || layers.label) promptLayers[id] = layers
  }
  if (ir.target.kind !== 'customMenu') {
    const used = g.order.length ? g.order[0]! : Object.keys(prompts)[0]
    return { lint: used ? [{ severity: 'warning', code: 'focus-not-menu', nodeId: used, nodeName: name(used), message: 'Focus graphs and prompts work in custom menus only; this SWF keeps the data but does not use it.' }] : [] }
  }
  return { ...(g.order.length ? { focus: { order: g.order, moves: g.moves } } : {}), ...(Object.keys(prompts).length ? { prompts } : {}), ...(Object.keys(promptLayers).length ? { promptLayers } : {}), lint }
}

/** True when the overlay gives any layer a focus order (the menu needs `inputContext` menuMode, S-A). */
export const hasFocusGraph = (nodes: Record<string, unknown>): boolean =>
  Object.values(nodes).some((o) => typeof (o as { focus?: { order?: unknown } } | undefined)?.focus?.order === 'number')
